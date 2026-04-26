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
 * Performs fast migration: renames the scheme in the manifest blob and
 * rebuilds the tree with only the manifest entry replaced.
 *
 * This preserves the entire tree structure (sub-manifests, chunk entries)
 * and only replaces the manifest blob, avoiding round-tripping through
 * createTree() which would flatten Merkle manifests.
 *
 * @param {Object} ctx
 * @param {CasService} ctx.service - CasService matching the entry's codec.
 * @param {CasService} ctx.rawService - Legacy-mode CasService for hash verification.
 * @param {string} ctx.treeOid - Original tree OID for hash verification context.
 * @param {Object} ctx.raw - Raw manifest data.
 * @param {Object} ctx.persistence - GitPersistenceAdapter instance.
 * @param {{ encode: Function }} ctx.codec - Codec matching the entry's format.
 * @returns {Promise<string>} New tree OID.
 */
async function migrateFast({ service, rawService, raw, treeOid, persistence, codec }) {
  await rawService._verifyManifestHash(raw, treeOid);

  const currentScheme = mapToCurrentScheme(raw.encryption.scheme);
  raw.encryption.scheme = currentScheme;

  if (!raw.formatVersion) {
    raw.formatVersion = service.formatVersion;
  }

  // Recompute manifest hash with the updated scheme
  const hashable = { ...raw };
  delete hashable.manifestHash;
  for (const key of Object.keys(hashable)) {
    if (hashable[key] === undefined) { delete hashable[key]; }
  }
  raw.manifestHash = await service.crypto.sha256(Buffer.from(codec.encode(hashable)));

  // Encode the updated manifest and write as a new blob
  const newManifestBlob = codec.encode(raw);
  const newManifestOid = await persistence.writeBlob(newManifestBlob);

  // Rebuild tree with only the manifest entry replaced
  const entries = await persistence.readTree(treeOid);
  const manifestEntry = entries.find((e) => e.name.startsWith('manifest.'));
  const newEntries = entries.map((e) =>
    e.name === manifestEntry.name
      ? `${e.mode} ${e.type} ${newManifestOid}\t${e.name}`
      : `${e.mode} ${e.type} ${e.oid}\t${e.name}`,
  );
  return await persistence.writeTree(newEntries);
}

// ---------------------------------------------------------------------------
// Full migration (restore via legacy service, re-store via current)
// ---------------------------------------------------------------------------

/**
 * Performs full migration: decrypt with legacy, re-encrypt with current.
 * @param {Object} ctx
 * @param {CasService} ctx.legacyService - Legacy-mode CasService.
 * @param {CasService} ctx.service - CasService matching the entry's codec.
 * @param {string} ctx.treeOid - Original tree OID.
 * @param {Object} ctx.keyOpts - { passphrase } or { encryptionKey }.
 * @param {Object} ctx.deps - Shared dependency bag for building services.
 * @param {{ encode: Function, extension: string }} ctx.codec - Codec matching the entry's format.
 * @returns {Promise<string>} New tree OID.
 */
async function migrateFull({ legacyService, service, treeOid, keyOpts, deps, codec }) {
  const manifest = await legacyService.readManifest({ treeOid });
  const source = legacyService.restoreStream({ manifest, ...keyOpts });

  // If the manifest has non-default chunking, build a writer service with
  // the matching chunker so re-stored data preserves chunk boundaries.
  let writerService = service;
  if (manifest.chunking) {
    const { default: resolveChunker } = await import(
      '../src/infrastructure/chunkers/resolveChunker.js'
    );
    const chunker = resolveChunker({
      chunking: {
        strategy: manifest.chunking.strategy,
        ...manifest.chunking.params,
      },
    });
    if (chunker) {
      writerService = new CasService({ ...deps, codec, chunker });
    }
  }

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

  const newManifest = await writerService.store(storeOpts);

  return await writerService.createTree({ manifest: newManifest });
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
      service: ctx.services[codecExt],
      rawService,
      raw,
      treeOid: entry.treeOid,
      persistence: ctx.persistence,
      codec: ctx.codecs[codecExt],
    });
  }

  if (classification.mode === 'full') {
    const keyOpts = buildKeyOpts(opts, classification);
    result.newTreeOid = await migrateFull({
      legacyService: ctx.legacyServices[codecExt],
      service: ctx.services[codecExt],
      treeOid: entry.treeOid,
      keyOpts,
      deps: ctx.deps,
      codec: ctx.codecs[codecExt],
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
  await cas.getService();
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

  const services = {};
  const legacyServices = {};
  const rawServices = {};
  for (const [ext, codec] of Object.entries(codecs)) {
    services[ext] = new CasService({ ...deps, codec });
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

  return { services, legacyServices, rawServices, codecs, deps, vault, persistence: deps.persistence };
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
  const entries = await vault.listVault();
  return entries.length === 0 ? null : entries;
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
