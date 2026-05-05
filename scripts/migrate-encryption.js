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
 *     --passphrase-file <path>  Passphrase file for v1 re-encryption (- for stdin)
 *     --passphrase <p>    Inline passphrase for v1 re-encryption; warns
 *     --key-file <path>   Raw 32-byte key file for re-encryption of v1 schemes
 *
 * @module
 */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
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
    'passphrase-file': { type: 'string' },
    'key-file': { type: 'string' },
    'vault-passphrase': { type: 'string' },
    'vault-passphrase-file': { type: 'string' },
    'vault-key-file': { type: 'string' },
    help: { type: 'boolean', default: false },
  },
};

function printUsage() {
  console.log('Usage: node scripts/migrate-encryption.js [options]');
  console.log('  --cwd <dir>        Git working directory (default: .)');
  console.log('  --execute          Perform migration (default: dry-run)');
  console.log('  --passphrase-file <path>  Read v1 re-encryption passphrase from file (- for stdin)');
  console.log('  --passphrase <p>   Inline v1 passphrase; warns, prefer --passphrase-file - or --key-file');
  console.log('  --key-file <path>  Raw 32-byte key file for v1 re-encryption');
  console.log('  --vault-passphrase-file <path>  Read privacy-vault passphrase from file (- for stdin)');
  console.log('  --vault-passphrase <p>       Inline privacy-vault passphrase; warns, prefer --vault-passphrase-file - or --vault-key-file');
  console.log('  --vault-key-file <path>      Raw 32-byte privacy-vault key file');
  console.log('  --help             Show this help');
}

/**
 * Converts parseArgs hyphenated option names into the internal option shape.
 * @param {Record<string, any>} values
 * @returns {Record<string, any>}
 */
function normalizeCliOptions(values) {
  return {
    cwd: values.cwd,
    execute: values.execute,
    passphrase: values.passphrase,
    passphraseFile: values['passphrase-file'],
    keyFile: values['key-file'],
    vaultPassphrase: values['vault-passphrase'],
    vaultPassphraseFile: values['vault-passphrase-file'],
    vaultKeyFile: values['vault-key-file'],
    help: values.help,
  };
}

/**
 * Creates warnings for inline secret sources that can leak through shell
 * history and process listings.
 * @param {{ passphrase?: string, vaultPassphrase?: string }} opts
 * @returns {string[]}
 */
function inlinePassphraseWarnings(opts) {
  const warnings = [];
  if (opts.passphrase) {
    warnings.push(
      'warning: --passphrase exposes secrets through shell history and process listings; ' +
      'prefer --passphrase-file - or --key-file',
    );
  }
  if (opts.vaultPassphrase) {
    warnings.push(
      'warning: --vault-passphrase exposes secrets through shell history and process listings; ' +
      'prefer --vault-passphrase-file - or --vault-key-file',
    );
  }
  return warnings;
}

/**
 * Emits warnings for inline passphrase arguments.
 * @param {{ passphrase?: string, vaultPassphrase?: string }} opts
 * @param {(message: string) => void} write
 */
function warnInlinePassphraseArgs(opts, write = process.stderr.write.bind(process.stderr)) {
  for (const warning of inlinePassphraseWarnings(opts)) {
    write(`${warning}\n`);
  }
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
  if (manifest.encryption?.recipients?.length > 0) {
    throw new Error(
      'Full migration for recipient-encrypted legacy manifests is not automatic. ' +
      'Re-store the asset with current recipients so recipient access is preserved.',
    );
  }
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

  await updateVaultForMigration({ ctx, entry, result, opts });

  return result;
}

/**
 * @param {Object} args
 * @param {Object} args.ctx
 * @param {{ slug: string }} args.entry
 * @param {{ newTreeOid: string|null }} args.result
 * @param {{ vaultEncryptionKey?: Uint8Array }} args.opts
 */
async function updateVaultForMigration({ ctx, entry, result, opts }) {
  if (!result.newTreeOid) { return; }
  await ctx.vault.addToVault({
    slug: entry.slug,
    treeOid: result.newTreeOid,
    force: true,
    encryptionKey: opts.vaultEncryptionKey,
  });
}

/**
 * Reads a 32-byte raw key file.
 * @param {string} keyFilePath
 * @returns {Uint8Array}
 */
function readKeyFile(keyFilePath) {
  const key = readFileSync(keyFilePath);
  if (key.length !== 32) {
    throw new Error(`Invalid key length: expected 32 bytes, got ${key.length} (${keyFilePath})`);
  }
  return key;
}

/**
 * Reads a passphrase file and strips one trailing line ending.
 * @param {string} filePath
 * @returns {string}
 */
function readPassphraseFile(filePath) {
  const label = filePath === '-' ? 'stdin' : filePath;
  const passphrase = readFileSync(filePath === '-' ? 0 : filePath, 'utf8').replace(/\r?\n$/u, '');
  if (!passphrase.trim()) {
    throw new Error(`Passphrase file is empty: ${label}`);
  }
  return passphrase;
}

/**
 * Builds key options for full-mode migration.
 * @param {{
 *   passphrase?: string,
 *   passphraseFile?: string,
 *   keyFile?: string,
 *   encryptionKey?: Uint8Array
 * }} opts - CLI options containing key material.
 * @param {{ scheme: string|undefined, mode: string, reason: string }} classification - Entry classification.
 * @returns {{ passphrase: string }|{ encryptionKey: Uint8Array }} Key options for re-encryption.
 */
function buildKeyOpts(opts, classification) {
  const sourceCount = [
    opts.passphrase,
    opts.passphraseFile,
    opts.keyFile,
    opts.encryptionKey,
  ].filter((value) => value !== undefined && value !== null && value !== '').length;

  if (sourceCount > 1) {
    throw new Error(
      'Provide exactly one full-migration credential source: ' +
      '--passphrase, --passphrase-file, --key-file, or injected encryptionKey.',
    );
  }
  if (opts.encryptionKey) {
    return { encryptionKey: opts.encryptionKey };
  }
  if (opts.keyFile) {
    return { encryptionKey: readKeyFile(opts.keyFile) };
  }
  if (opts.passphraseFile) {
    return { passphrase: readPassphraseFile(opts.passphraseFile) };
  }
  if (!opts.passphrase) {
    throw new Error(
      `Entry requires re-encryption (${classification.scheme}) ` +
      'but no --passphrase, --passphrase-file, or --key-file was provided.',
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

  return { cas, services, legacyServices, rawServices, codecs, deps, vault, persistence: deps.persistence };
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

/**
 * Derives the vault encryption key from vault metadata and passphrase.
 * @param {ContentAddressableStore} cas
 * @param {Object} metadata
 * @param {string} passphrase
 * @returns {Promise<Uint8Array>}
 */
async function deriveVaultKey(cas, metadata, passphrase) {
  const kdf = metadata.encryption?.kdf;
  if (!kdf) {
    throw new Error('Privacy vault metadata is missing KDF configuration.');
  }
  const { key } = await cas.deriveKey({
    passphrase,
    salt: Buffer.from(kdf.salt, 'base64'),
    algorithm: kdf.algorithm,
    iterations: kdf.iterations,
    cost: kdf.cost,
    blockSize: kdf.blockSize,
    parallelization: kdf.parallelization,
    keyLength: kdf.keyLength,
  });
  return key;
}

/**
 * Resolves the key needed to enumerate/update privacy-enabled vaults.
 * @param {Object} ctx - Migration context.
 * @param {Record<string, any>} opts - Normalized migration options.
 * @returns {Promise<Uint8Array|undefined>}
 */
async function resolveVaultEncryptionKey(ctx, opts) {
  const metadata = await ctx.vault.getVaultMetadata();
  if (!metadata?.privacy?.enabled) {
    return undefined;
  }
  if (opts.vaultKeyFile) {
    return readKeyFile(opts.vaultKeyFile);
  }

  const passphrase = opts.vaultPassphraseFile
    ? readPassphraseFile(opts.vaultPassphraseFile)
    : opts.vaultPassphrase || resolveContentPassphraseFallback(opts);

  if (!passphrase) {
    throw new Error(
      'Privacy mode is enabled. Provide --vault-passphrase, ' +
      '--vault-passphrase-file, --vault-key-file, --passphrase-file, or --passphrase if the ' +
      'content and vault passphrases are the same.',
    );
  }

  return await deriveVaultKey(ctx.cas, metadata, passphrase);
}

/**
 * Resolves the content passphrase as a fallback for vault migration when the
 * same passphrase protects both content and the privacy vault.
 * @param {{ passphrase?: string, passphraseFile?: string }} opts
 * @returns {string|undefined}
 */
function resolveContentPassphraseFallback(opts) {
  const sourceCount = [opts.passphrase, opts.passphraseFile]
    .filter((value) => value !== undefined && value !== null && value !== '').length;
  if (sourceCount > 1) {
    throw new Error(
      'Provide exactly one content passphrase fallback for privacy migration: ' +
      '--passphrase or --passphrase-file.',
    );
  }
  if (opts.passphraseFile) {
    return readPassphraseFile(opts.passphraseFile);
  }
  return opts.passphrase;
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

async function listVaultEntries(vault, { encryptionKey } = {}) {
  return await vault.listVault({ encryptionKey });
}

async function main() {
  const { values } = parseArgs(ARGS_CONFIG);
  const opts = normalizeCliOptions(values);
  warnInlinePassphraseArgs(opts);

  if (opts.help) {
    printUsage();
    return;
  }

  const cwd = resolve(opts.cwd);
  console.log(`git-cas upgrade — ${opts.execute ? 'EXECUTE' : 'DRY-RUN'} mode`);
  console.log(`Working directory: ${cwd}`);

  const plumbing = createGitPlumbing({ cwd });
  const ctx = await createMigrationContext(plumbing);
  opts.vaultEncryptionKey = await resolveVaultEncryptionKey(ctx, opts);

  const entries = await listVaultEntries(ctx.vault, { encryptionKey: opts.vaultEncryptionKey });

  if (entries.length === 0) {
    const metadata = await ctx.vault.getVaultMetadata();
    console.log(metadata === null
      ? 'No vault found — nothing to migrate.'
      : 'Vault is empty — nothing to migrate.');
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
  migrateEntry,
  buildKeyOpts,
  createMigrationContext,
  detectCodec,
  inlinePassphraseWarnings,
  listVaultEntries,
  normalizeCliOptions,
  resolveVaultEncryptionKey,
  warnInlinePassphraseArgs,
};

if (process.argv[1]?.endsWith('migrate-encryption.js')) {
  main().catch((err) => {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  });
}
