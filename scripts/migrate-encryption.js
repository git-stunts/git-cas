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
  const scheme = raw.encryption?.scheme;

  if (!scheme) {
    return { mode: 'skip', scheme, reason: 'unencrypted' };
  }
  if (CURRENT_SCHEMES.has(scheme)) {
    return { mode: 'skip', scheme, reason: 'already current' };
  }
  if (!isLegacyScheme(scheme)) {
    return { mode: 'skip', scheme, reason: 'unknown scheme' };
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
 * @param {CasService} ctx.rawService - Legacy-mode CasService for raw reads.
 * @param {string} ctx.treeOid
 * @param {Object} ctx.raw - Raw manifest data.
 * @returns {Promise<string>} New tree OID.
 */
async function migrateFast({ service, raw }) {
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
 * Collects the full plaintext from a legacy restore stream.
 * @param {AsyncIterable<Buffer>} stream
 * @returns {Promise<Buffer>}
 */
async function drainStream(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Wraps a buffer as an async iterable.
 * @param {Buffer} buf
 * @returns {AsyncIterable<Buffer>}
 */
async function* bufferToStream(buf) {
  yield buf;
}

/**
 * Performs full migration: decrypt with legacy, re-encrypt with current.
 * @param {Object} ctx
 * @param {CasService} ctx.legacyService - Legacy-mode CasService.
 * @param {CasService} ctx.service - Normal CasService.
 * @param {string} ctx.treeOid
 * @param {Object} ctx.keyOpts - { passphrase } or { encryptionKey }.
 * @returns {Promise<string>} New tree OID.
 */
async function migrateFull({ legacyService, service, treeOid, keyOpts }) {
  const manifest = await legacyService.readManifest({ treeOid });
  const plaintext = await drainStream(
    legacyService.restoreStream({ manifest, ...keyOpts }),
  );

  const newManifest = await service.store({
    source: bufferToStream(plaintext),
    slug: manifest.slug,
    filename: manifest.filename,
    ...keyOpts,
    encryption: { scheme: manifest.encryption.scheme },
  });

  return await service.createTree({ manifest: newManifest });
}

// ---------------------------------------------------------------------------
// Migration orchestrator
// ---------------------------------------------------------------------------

/**
 * Runs migration for a single vault entry.
 * @param {Object} ctx - Migration context.
 * @param {{ slug: string, treeOid: string }} entry
 * @param {Object} opts - { execute, passphrase }
 * @returns {Promise<Object>} Result record.
 */
async function migrateEntry(ctx, entry, opts) {
  const { rawService } = ctx;
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
    result.newTreeOid = await migrateFast({ service: ctx.service, raw });
  }

  if (classification.mode === 'full') {
    const keyOpts = buildKeyOpts(opts, classification);
    result.newTreeOid = await migrateFull({
      legacyService: ctx.legacyService,
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
 * @param {Object} opts
 * @param {Object} classification
 * @returns {Object}
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
 * Creates services with proper legacy mode support.
 * @param {Object} plumbing
 * @returns {Promise<Object>}
 */
async function createMigrationContext(plumbing) {
  const cas = new ContentAddressableStore({ plumbing });
  const service = await cas.getService();
  const vault = await cas.getVaultService();

  const { default: JsonCodec } = await import(
    '../src/infrastructure/codecs/JsonCodec.js'
  );
  const deps = await buildLegacyDeps(plumbing);

  const legacyService = new CasService({
    ...deps,
    codec: new JsonCodec(),
    legacyMode: true,
  });

  const rawService = new CasService({
    ...deps,
    codec: new JsonCodec(),
    legacyMode: true,
  });

  return { service, legacyService, rawService, vault };
}

/**
 * Builds shared dependencies for legacy CasService instances.
 * @param {Object} plumbing
 * @returns {Promise<Object>}
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

  let entries;
  try {
    entries = await ctx.vault.listVault();
  } catch {
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

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exitCode = 1;
});
