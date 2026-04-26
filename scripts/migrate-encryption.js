#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * @fileoverview Migration script for git-cas v6.0.0 encryption scheme upgrade.
 *
 * Upgrades vault entries from legacy encryption scheme identifiers (v1/v2)
 * to the simplified current scheme names. Two modes:
 *
 * - **Fast** (rename-only): v2 schemes and `convergent-v1` — scheme field is
 *   renamed in-place. No re-encryption needed.
 * - **Full** (re-encrypt): v1 whole/framed — data must be decrypted without
 *   AAD and re-stored with AAD under the current scheme.
 *
 * Usage:
 *   node scripts/migrate-encryption.js [options]
 *     --cwd <dir>        Git working directory (default: .)
 *     --execute           Actually perform migration (default: dry-run)
 *     --passphrase <p>    Passphrase for re-encryption of v1 schemes
 *
 * @module
 */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import ContentAddressableStore from '../index.js';
import { createGitPlumbing } from '../src/infrastructure/createGitPlumbing.js';
import CasService from '../src/domain/services/CasService.js';
import {
  isLegacyScheme, mapToCurrentScheme, isLegacyNoAad,
  CURRENT_SCHEMES,
} from '../src/domain/encryption/schemes.js';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const ARGS_CONFIG = {
  options: {
    cwd: { type: 'string', default: '.' },
    execute: { type: 'boolean', default: false },
    passphrase: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
};

function printUsage() {
  console.log('Usage: node scripts/migrate-encryption.js [options]');
  console.log('  --cwd <dir>        Git working directory (default: .)');
  console.log('  --execute          Perform migration (default: dry-run)');
  console.log('  --passphrase <p>   Passphrase for v1 re-encryption');
  console.log('  --help             Show this help');
}

// ---------------------------------------------------------------------------
// Entry classification
// ---------------------------------------------------------------------------

/**
 * Classifies a vault entry for migration.
 * @param {Object} raw - Raw decoded manifest from readManifestRaw.
 * @returns {{ mode: 'skip'|'fast'|'full', scheme: string|undefined, reason: string }}
 */
function classifyEntry(raw) {
  if (!raw.encryption) {
    return { mode: 'skip', scheme: undefined, reason: 'unencrypted' };
  }

  const scheme = raw.encryption.scheme;

  if (!scheme) {
    return { mode: 'full', scheme, reason: 'schemeless legacy — re-encrypt' };
  }
  if (CURRENT_SCHEMES.has(scheme)) {
    return { mode: 'skip', scheme, reason: 'already current' };
  }
  if (!isLegacyScheme(scheme)) {
    return { mode: 'skip', scheme, reason: 'unknown scheme' };
  }
  if (scheme === 'convergent-v1') {
    return { mode: 'fast', scheme, reason: 'convergent — rename only' };
  }
  if (isLegacyNoAad(scheme)) {
    return { mode: 'full', scheme, reason: 'v1 (no AAD) — re-encrypt' };
  }
  return { mode: 'fast', scheme, reason: 'v2 — rename only' };
}

// ---------------------------------------------------------------------------
// Fast migration (rename scheme in manifest blob, rebuild tree)
// ---------------------------------------------------------------------------

/**
 * Performs fast migration: renames the scheme and rebuilds the tree.
 * @param {Object} ctx
 * @param {CasService} ctx.service - Normal CasService (current schemes).
 * @param {CasService} ctx.rawService - Legacy-mode CasService for hash verification.
 * @param {string} ctx.treeOid - Original tree OID for hash verification context.
 * @param {Object} ctx.raw - Raw manifest data.
 * @returns {Promise<string>} New tree OID.
 */
async function migrateFast({ service, rawService, raw, treeOid }) {
  await rawService._verifyManifestHash(raw, treeOid);

  const currentScheme = mapToCurrentScheme(raw.encryption.scheme);
  raw.encryption.scheme = currentScheme;

  if (!raw.formatVersion) {
    raw.formatVersion = service.formatVersion;
  }

  const { default: Manifest } = await import(
    '../src/domain/value-objects/Manifest.js'
  );
  const manifest = new Manifest(raw);
  return await service.createTree({ manifest });
}

// ---------------------------------------------------------------------------
// Full migration (restore via legacy service, re-store via current)
// ---------------------------------------------------------------------------

/**
 * Performs full migration: decrypt with legacy, re-encrypt with current.
 * @param {Object} ctx
 * @param {CasService} ctx.legacyService - Legacy-mode CasService.
 * @param {CasService} ctx.service - Normal CasService.
 * @param {string} ctx.treeOid - Original tree OID.
 * @param {Object} ctx.keyOpts - { passphrase } or { encryptionKey }.
 * @returns {Promise<string>} New tree OID.
 */
async function migrateFull({ legacyService, service, treeOid, keyOpts }) {
  const manifest = await legacyService.readManifest({ treeOid });
  const source = legacyService.restoreStream({ manifest, ...keyOpts });

  const storeOpts = {
    source,
    slug: manifest.slug,
    filename: manifest.filename,
    ...keyOpts,
    encryption: { scheme: manifest.encryption.scheme },
  };

  if (manifest.compression) {
    storeOpts.compression = manifest.compression;
  }

  const newManifest = await service.store(storeOpts);

  return await service.createTree({ manifest: newManifest });
}

// ---------------------------------------------------------------------------
// Migration orchestrator
// ---------------------------------------------------------------------------

/**
 * Runs migration for a single vault entry.
 * @param {Object} ctx - Migration context with codec-keyed services.
 * @param {{ slug: string, treeOid: string }} entry - Vault entry to migrate.
 * @param {{ execute: boolean, passphrase?: string }} opts - Migration options.
 * @returns {Promise<Object>} Result record.
 */
async function migrateEntry(ctx, entry, opts) {
  const codecExt = await detectCodec(ctx.persistence, entry.treeOid);
  const rawService = ctx.rawServices[codecExt];
  const raw = await rawService.readManifestRaw({ treeOid: entry.treeOid });
  const classification = classifyEntry(raw);

  const result = {
    slug: entry.slug,
    ...classification,
    treeOid: entry.treeOid,
    newTreeOid: null,
  };

  if (classification.mode === 'skip' || !opts.execute) {
    return result;
  }

  if (classification.mode === 'fast') {
    result.newTreeOid = await migrateFast({
      service: ctx.service, rawService, raw, treeOid: entry.treeOid,
    });
  }

  if (classification.mode === 'full') {
    const keyOpts = buildKeyOpts(opts, classification);
    result.newTreeOid = await migrateFull({
      legacyService: ctx.legacyServices[codecExt],
      service: ctx.service,
      treeOid: entry.treeOid,
      keyOpts,
    });
  }

  if (result.newTreeOid) {
    await ctx.vault.addToVault({
      slug: entry.slug,
      treeOid: result.newTreeOid,
      force: true,
    });
  }

  return result;
}

/**
 * Builds key options for full-mode migration.
 * @param {{ passphrase?: string }} opts - CLI options containing passphrase.
 * @param {{ scheme: string|undefined, mode: string, reason: string }} classification - Entry classification.
 * @returns {{ passphrase: string }} Key options for re-encryption.
 */
function buildKeyOpts(opts, classification) {
  if (!opts.passphrase) {
    throw new Error(
      `Entry requires re-encryption (${classification.scheme}) ` +
      'but no --passphrase was provided.',
    );
  }
  return { passphrase: opts.passphrase };
}

// ---------------------------------------------------------------------------
// Service construction
// ---------------------------------------------------------------------------

/**
 * Detects the codec type from a tree OID by inspecting manifest entry names.
 * @param {Object} persistence - GitPersistenceAdapter instance.
 * @param {string} treeOid - Git tree OID to inspect.
 * @returns {Promise<'json'|'cbor'>} Detected codec extension.
 */
async function detectCodec(persistence, treeOid) {
  const entries = await persistence.readTree(treeOid);
  const manifestEntry = entries.find((e) => e.name.startsWith('manifest.'));
  if (!manifestEntry) { return 'json'; }
  return manifestEntry.name.endsWith('.cbor') ? 'cbor' : 'json';
}

/**
 * Creates services with proper legacy mode support.
 * @param {Object} plumbing - Git plumbing instance.
 * @returns {Promise<Object>} Migration context with codec-keyed legacy services.
 */
async function createMigrationContext(plumbing) {
  const cas = new ContentAddressableStore({ plumbing });
  const service = await cas.getService();
  const vault = await cas.getVaultService();

  const { default: JsonCodec } = await import(
    '../src/infrastructure/codecs/JsonCodec.js'
  );
  const { default: CborCodec } = await import(
    '../src/infrastructure/codecs/CborCodec.js'
  );
  const deps = await buildLegacyDeps(plumbing);

  const codecs = {
    json: new JsonCodec(),
    cbor: new CborCodec(),
  };

  const legacyServices = {};
  const rawServices = {};
  for (const [ext, codec] of Object.entries(codecs)) {
    legacyServices[ext] = new CasService({
      ...deps,
      codec,
      legacyMode: true,
    });
    rawServices[ext] = new CasService({
      ...deps,
      codec,
      legacyMode: true,
    });
  }

  return { service, legacyServices, rawServices, vault, persistence: deps.persistence };
}

/**
 * Builds shared dependencies for legacy CasService instances.
 * @param {Object} plumbing - Git plumbing instance.
 * @returns {Promise<Object>} Shared dependency bag for CasService construction.
 */
async function buildLegacyDeps(plumbing) {
  const { default: GitPersistenceAdapter } = await import(
    '../src/infrastructure/adapters/GitPersistenceAdapter.js'
  );
  const { default: createCryptoAdapter } = await import(
    '../src/infrastructure/adapters/createCryptoAdapter.js'
  );
  const { default: SilentObserver } = await import(
    '../src/infrastructure/adapters/SilentObserver.js'
  );
  const { default: FixedChunker } = await import(
    '../src/infrastructure/chunkers/FixedChunker.js'
  );
  const { default: NodeCompressionAdapter } = await import(
    '../src/infrastructure/adapters/NodeCompressionAdapter.js'
  );
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { version } = require('../package.json');

  return {
    persistence: new GitPersistenceAdapter({ plumbing }),
    crypto: await createCryptoAdapter(),
    observability: new SilentObserver(),
    chunker: new FixedChunker({ chunkSize: 256 * 1024 }),
    compressionAdapter: new NodeCompressionAdapter(),
    chunkSize: 256 * 1024,
    formatVersion: version,
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * Prints a migration report to stdout.
 * @param {Object[]} results
 * @param {boolean} execute
 */
function printReport(results, execute) {
  const prefix = execute ? 'MIGRATED' : 'DRY-RUN';
  const counts = { skip: 0, fast: 0, full: 0 };

  console.log('');
  console.log(`${'Slug'.padEnd(40)} ${'Mode'.padEnd(6)} Scheme → Current  Notes`);
  console.log('-'.repeat(90));

  for (const r of results) {
    const mapped = mapToCurrentScheme(r.scheme) || r.scheme || '(none)';
    const arrow = r.scheme ? `${r.scheme} → ${mapped}` : '(none)';
    const note = r.newTreeOid ? `tree:${r.newTreeOid.slice(0, 8)}` : r.reason;
    console.log(`${r.slug.padEnd(40)} ${r.mode.padEnd(6)} ${arrow.padEnd(24)} ${note}`);
    counts[r.mode]++;
  }

  console.log('');
  console.log(`[${prefix}] ${results.length} entries scanned:`);
  console.log(`  ${counts.skip} skipped, ${counts.fast} fast, ${counts.full} full`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function listVaultEntries(vault) {
  try {
    return await vault.listVault();
  } catch (err) {
    const msg = err?.message ?? '';
    if (err?.code === 'GIT_ERROR' && /ref.*(not found|does not exist)/i.test(msg)) {
      return null;
    }
    throw err;
  }
}

async function main() {
  const { values: opts } = parseArgs(ARGS_CONFIG);

  if (opts.help) {
    printUsage();
    return;
  }

  const cwd = resolve(opts.cwd);
  console.log(`git-cas upgrade — ${opts.execute ? 'EXECUTE' : 'DRY-RUN'} mode`);
  console.log(`Working directory: ${cwd}`);

  const plumbing = createGitPlumbing({ cwd });
  const ctx = await createMigrationContext(plumbing);

  const entries = await listVaultEntries(ctx.vault);

  if (entries === null) {
    console.log('No vault found — nothing to migrate.');
    return;
  }

  if (entries.length === 0) {
    console.log('Vault is empty — nothing to migrate.');
    return;
  }

  console.log(`Found ${entries.length} vault entries.`);

  const results = [];
  for (const entry of entries) {
    const result = await migrateEntry(ctx, entry, opts);
    results.push(result);
  }

  printReport(results, opts.execute);
}

export {
  classifyEntry,
  migrateFast,
  migrateFull,
  buildKeyOpts,
  createMigrationContext,
  detectCodec,
};

if (process.argv[1]?.endsWith('migrate-encryption.js')) {
  main().catch((err) => {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  });
}
