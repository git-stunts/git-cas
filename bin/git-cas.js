#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { program, Option } from 'commander';
import ContentAddressableStore, { EventEmitterObserver, CborCodec } from '../index.js';
import Manifest from '../src/domain/value-objects/Manifest.js';
import { createGitPlumbing } from '../src/infrastructure/createGitPlumbing.js';
import { createStoreProgress, createRestoreProgress } from './ui/progress.js';
import { renderEncryptionCard } from './ui/encryption-card.js';
import { renderHistoryTimeline } from './ui/history-timeline.js';
import { renderManifestView } from './ui/manifest-view.js';
import { renderHeatmap } from './ui/heatmap.js';
import {
  buildVaultStats,
  inspectVaultHealth,
  renderDoctorReport,
  renderVaultStats,
} from './ui/vault-report.js';
import { runAction } from './actions.js';
import { runAgentCli } from './agent/cli.js';
import { flushStdioAndExit, installBrokenPipeHandlers } from './io.js';
import { filterEntries, formatTable, formatTabSeparated } from './ui/vault-list.js';
import { readPassphraseFile } from './ui/passphrase-prompt.js';
import {
  hasExplicitPassphraseSource,
  hasPassphraseSource,
  resolvePassphrase,
  validatePassphraseSources,
} from './passphrase-source.js';
import { loadConfig, mergeConfig } from './config.js';

import { resolveVersionString } from '../src/build-version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_VERSION = resolveVersionString(
  JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')).version,
);

const getJson = () => program.opts().json;
installBrokenPipeHandlers();

if (process.argv[2] === 'agent') {
  await runAgentCli(process.argv.slice(3));
  await flushStdioAndExit();
}

program
  .name('git-cas')
  .description('Content Addressable Storage backed by Git')
  .version(CLI_VERSION)
  .option('-q, --quiet', 'Suppress progress output')
  .option('--json', 'Output results as JSON');

/**
 * Read a 32-byte raw encryption key from a file.
 *
 * @param {string} keyFilePath
 * @returns {Buffer}
 */
function readKeyFile(keyFilePath) {
  const buf = readFileSync(keyFilePath);
  if (buf.length !== 32) {
    throw new Error(`Invalid key length: expected 32 bytes, got ${buf.length} (${keyFilePath})`);
  }
  return buf;
}

/**
 * Create a CAS instance for the given working directory.
 *
 * @param {string} cwd
 * @param {Record<string, any>} [opts]
 * @returns {ContentAddressableStore}
 */
function createCas(cwd, opts = {}) {
  const plumbing = createGitPlumbing({ cwd });
  /** @type {Record<string, any>} */
  const casOpts = { plumbing, ...opts };
  if (casOpts.codec === 'cbor') {
    casOpts.codec = new CborCodec();
  }
  return new ContentAddressableStore(casOpts);
}

/**
 * Derive the encryption key from vault metadata + passphrase.
 *
 * @param {ContentAddressableStore} cas
 * @param {import('../index.js').VaultMetadata} metadata
 * @param {string} passphrase
 * @returns {Promise<Buffer>}
 */
async function deriveVaultKey(cas, metadata, passphrase) {
  if (!metadata.encryption?.kdf) {
    throw new Error('Missing or malformed encryption metadata');
  }
  const { kdf } = metadata.encryption;
  const { key } = await cas.deriveKey({
    passphrase,
    salt: Buffer.from(kdf.salt, 'base64'),
    algorithm: /** @type {"pbkdf2" | "scrypt"} */ (kdf.algorithm),
    iterations: kdf.iterations,
    cost: kdf.cost,
    blockSize: kdf.blockSize,
    parallelization: kdf.parallelization,
  });
  return key;
}

/**
 * Validate human CLI credential sources so explicit-but-empty values still count as provided.
 *
 * @param {Record<string, any>} opts
 */
function validateCredentialSources(opts) {
  validatePassphraseSources(opts);
  if (opts.keyFile !== undefined && hasExplicitPassphraseSource(opts)) {
    throw new Error('Provide --key-file or a vault passphrase source, not both');
  }
}

/**
 * Resolve encryption key from --key-file or --vault-passphrase / GIT_CAS_PASSPHRASE.
 *
 * @param {ContentAddressableStore} cas
 * @param {Record<string, any>} opts
 * @returns {Promise<Buffer | undefined>}
 */
async function resolveEncryptionKey(cas, opts) {
  if (opts.keyFile) {
    return readKeyFile(opts.keyFile);
  }
  const metadata = await cas.getVaultMetadata();
  if (!metadata?.encryption) {
    if (hasPassphraseSource(opts)) {
      process.stderr.write('warning: passphrase ignored (vault is not encrypted)\n');
    }
    return undefined;
  }
  const passphrase = await resolvePassphrase(opts);
  if (!passphrase) {
    return undefined;
  }
  return deriveVaultKey(cas, metadata, passphrase);
}

/**
 * Validate --slug / --oid flags (exactly one required).
 *
 * @param {Record<string, any>} opts
 */
function validateRestoreFlags(opts) {
  if (opts.slug && opts.oid) {
    throw new Error('Provide --slug or --oid, not both');
  }
  if (!opts.slug && !opts.oid) {
    throw new Error('Provide --slug <slug> or --oid <tree-oid>');
  }
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} StoreFileOpts
 * @property {string} filePath - Path to the file to store.
 * @property {string} slug - Asset slug identifier.
 * @property {Buffer} [encryptionKey] - 32-byte AES-256-GCM key.
 * @property {Array<{ label: string, key: Buffer }>} [recipients] - Envelope recipients.
 */

/**
 * Build store options, resolving encryption key or recipients.
 *
 * @param {ContentAddressableStore} cas
 * @param {string} file
 * @param {Record<string, any>} opts
 * @returns {Promise<StoreFileOpts>}
 */
async function buildStoreOpts(cas, file, opts) {
  /** @type {StoreFileOpts} */
  const storeOpts = { filePath: file, slug: opts.slug };
  if (opts.recipient) {
    storeOpts.recipients = opts.recipient;
  } else {
    const encryptionKey = await resolveEncryptionKey(cas, opts);
    if (encryptionKey) {
      storeOpts.encryptionKey = encryptionKey;
    }
  }
  return storeOpts;
}

/**
 * Parse a --recipient flag value into { label, key }.
 * Format: label:keyfile
 *
 * @param {string} value
 * @param {Array<{ label: string, key: Buffer }>} [previous]
 * @returns {Array<{ label: string, key: Buffer }>}
 */
function parseRecipient(value, previous) {
  const sep = value.indexOf(':');
  if (sep < 1) {
    throw new Error(`Invalid --recipient format "${value}": expected label:keyfile`);
  }
  const label = value.slice(0, sep);
  const keyfile = value.slice(sep + 1);
  if (!keyfile) {
    throw new Error(`Invalid --recipient format "${value}": missing keyfile path`);
  }
  const key = readKeyFile(keyfile);
  const list = previous || [];
  list.push({ label, key });
  return list;
}

/** @param {string} v */
const parseIntFlag = (v) => {
  if (!/^-?\d+$/.test(v)) {
    throw new Error(`Expected an integer, got "${v}"`);
  }
  const n = Number(v);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`Expected a safe integer, got "${v}"`);
  }
  return n;
};

program
  .command('store <file>')
  .description('Store a file into Git CAS')
  .requiredOption('--slug <slug>', 'Asset slug identifier')
  .option('--key-file <path>', 'Path to 32-byte raw encryption key file')
  .option('--recipient <label:keyfile>', 'Envelope recipient (repeatable)', parseRecipient)
  .option('--tree', 'Also create a Git tree and print its OID')
  .option('--force', 'Overwrite existing vault entry')
  .option(
    '--vault-passphrase <pass>',
    'Vault-level passphrase for encryption (prefer GIT_CAS_PASSPHRASE env var)'
  )
  .option('--vault-passphrase-file <path>', 'Read vault passphrase from file (use - for stdin)')
  .option(
    '--os-keychain-target <target>',
    'Read vault passphrase from OS keychain target via @git-stunts/vault'
  )
  .option(
    '--os-keychain-account <account>',
    'OS keychain account namespace for --os-keychain-target (default: git-cas)'
  )
  .option('--gzip', 'Enable gzip compression')
  .addOption(new Option('--strategy <type>', 'Chunking strategy').choices(['fixed', 'cdc']))
  .option('--chunk-size <n>', 'Chunk size in bytes', parseIntFlag)
  .option('--concurrency <n>', 'Parallel chunk I/O operations', parseIntFlag)
  .addOption(new Option('--codec <type>', 'Manifest codec').choices(['json', 'cbor']))
  .option('--target-chunk-size <n>', 'CDC target chunk size', parseIntFlag)
  .option('--min-chunk-size <n>', 'CDC minimum chunk size', parseIntFlag)
  .option('--max-chunk-size <n>', 'CDC maximum chunk size', parseIntFlag)
  .option('--merkle-threshold <n>', 'Chunk count threshold for Merkle sub-manifests', parseIntFlag)
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(
    runAction(async (/** @type {string} */ file, /** @type {Record<string, any>} */ opts) => {
      validateCredentialSources(opts);
      if (opts.recipient && (opts.keyFile || hasExplicitPassphraseSource(opts))) {
        throw new Error(
          'Provide --key-file or a vault passphrase source (--vault-passphrase, --vault-passphrase-file, --os-keychain-target, GIT_CAS_PASSPHRASE), or --recipient — not both'
        );
      }
      if (opts.force && !opts.tree) {
        throw new Error('--force requires --tree');
      }
      const json = program.opts().json;
      const quiet = program.opts().quiet || json;
      const observer = new EventEmitterObserver();

      const config = loadConfig(opts.cwd);
      const { casConfig, storeExtras } = mergeConfig(opts, config);
      const cas = createCas(opts.cwd, { observability: observer, ...casConfig });

      const storeOpts = await buildStoreOpts(cas, file, opts);
      Object.assign(storeOpts, storeExtras);
      const progress = createStoreProgress({ filePath: file, chunkSize: cas.chunkSize, quiet });
      progress.attach(observer);
      let manifest;
      try {
        manifest = await cas.storeFile(storeOpts);
      } finally {
        progress.detach();
      }

      if (opts.tree) {
        const treeOid = await cas.createTree({ manifest });
        await cas.addToVault({ slug: opts.slug, treeOid, force: !!opts.force });
        process.stdout.write(json ? `${JSON.stringify({ treeOid })}\n` : `${treeOid}\n`);
      } else {
        const output = json
          ? JSON.stringify({ manifest: manifest.toJSON() })
          : JSON.stringify(manifest.toJSON(), null, 2);
        process.stdout.write(`${output}\n`);
      }
    }, getJson)
  );

// ---------------------------------------------------------------------------
// tree
// ---------------------------------------------------------------------------
program
  .command('tree')
  .description('Create a Git tree from a manifest')
  .requiredOption('--manifest <path>', 'Path to manifest JSON file')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(
    runAction(async (/** @type {Record<string, any>} */ opts) => {
      const cas = createCas(opts.cwd);
      const raw = readFileSync(opts.manifest, 'utf8');
      const manifest = new Manifest(JSON.parse(raw));
      const treeOid = await cas.createTree({ manifest });
      const json = program.opts().json;
      if (json) {
        process.stdout.write(`${JSON.stringify({ treeOid })}\n`);
      } else {
        process.stdout.write(`${treeOid}\n`);
      }
    }, getJson)
  );

// ---------------------------------------------------------------------------
// inspect
// ---------------------------------------------------------------------------
program
  .command('inspect')
  .description('Inspect a stored manifest')
  .option('--slug <slug>', 'Resolve tree OID from vault slug')
  .option('--oid <tree-oid>', 'Direct tree OID')
  .option('--heatmap', 'Show chunk heatmap visualization')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(
    runAction(async (/** @type {Record<string, any>} */ opts) => {
      validateRestoreFlags(opts);
      const cas = createCas(opts.cwd);
      const treeOid = opts.oid || (await cas.resolveVaultEntry({ slug: opts.slug }));
      const manifest = await cas.readManifest({ treeOid });
      const json = program.opts().json;

      if (json) {
        process.stdout.write(`${JSON.stringify(manifest.toJSON())}\n`);
      } else if (opts.heatmap) {
        process.stdout.write(renderHeatmap({ manifest: manifest.toJSON() }));
      } else if (process.stdout.isTTY) {
        process.stdout.write(renderManifestView({ manifest: manifest.toJSON() }));
      } else {
        process.stdout.write(`${JSON.stringify(manifest.toJSON(), null, 2)}\n`);
      }
    }, getJson)
  );

// ---------------------------------------------------------------------------
// restore
// ---------------------------------------------------------------------------
program
  .command('restore')
  .description('Restore a file from a Git CAS tree')
  .requiredOption('--out <path>', 'Output file path')
  .option('--slug <slug>', 'Resolve tree OID from vault slug')
  .option('--oid <tree-oid>', 'Direct tree OID')
  .option('--key-file <path>', 'Path to 32-byte raw encryption key file')
  .option(
    '--vault-passphrase <pass>',
    'Vault-level passphrase for decryption (prefer GIT_CAS_PASSPHRASE env var)'
  )
  .option('--vault-passphrase-file <path>', 'Read vault passphrase from file (use - for stdin)')
  .option(
    '--os-keychain-target <target>',
    'Read vault passphrase from OS keychain target via @git-stunts/vault'
  )
  .option(
    '--os-keychain-account <account>',
    'OS keychain account namespace for --os-keychain-target (default: git-cas)'
  )
  .option('--concurrency <n>', 'Parallel chunk I/O operations', parseIntFlag)
  .option(
    '--max-restore-buffer <n>',
    'Max bytes for buffered encrypted/compressed restore',
    parseIntFlag
  )
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(
    runAction(async (/** @type {Record<string, any>} */ opts) => {
      validateCredentialSources(opts);
      validateRestoreFlags(opts);
      const quiet = program.opts().quiet || program.opts().json;
      const observer = new EventEmitterObserver();

      const config = loadConfig(opts.cwd);
      /** @type {Record<string, any>} */
      const casConfig = {};
      const concurrency = opts.concurrency ?? config.concurrency;
      const maxRestoreBufferSize = opts.maxRestoreBuffer ?? config.maxRestoreBufferSize;
      if (concurrency !== undefined) {
        casConfig.concurrency = concurrency;
      }
      if (maxRestoreBufferSize !== undefined) {
        casConfig.maxRestoreBufferSize = maxRestoreBufferSize;
      }

      const cas = createCas(opts.cwd, { observability: observer, ...casConfig });
      const treeOid = opts.oid || (await cas.resolveVaultEntry({ slug: opts.slug }));
      const manifest = await cas.readManifest({ treeOid });

      const encryptionKey = await resolveEncryptionKey(cas, opts);

      const progress = createRestoreProgress({
        totalChunks: manifest.chunks.length,
        quiet,
      });
      progress.attach(observer);
      let bytesWritten;
      try {
        ({ bytesWritten } = await cas.restoreFile({
          manifest,
          ...(encryptionKey ? { encryptionKey } : {}),
          outputPath: opts.out,
        }));
      } finally {
        progress.detach();
      }
      const json = program.opts().json;
      if (json) {
        process.stdout.write(`${JSON.stringify({ bytesWritten })}\n`);
      } else {
        process.stdout.write(`${bytesWritten}\n`);
      }
    }, getJson)
  );

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------
program
  .command('verify')
  .description('Verify integrity of a stored asset (checks blob hashes; no key needed)')
  .option('--slug <slug>', 'Resolve tree OID from vault slug')
  .option('--oid <tree-oid>', 'Direct tree OID')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(
    runAction(async (/** @type {Record<string, any>} */ opts) => {
      validateRestoreFlags(opts);
      const cas = createCas(opts.cwd);
      const treeOid = opts.oid || (await cas.resolveVaultEntry({ slug: opts.slug }));
      const manifest = await cas.readManifest({ treeOid });
      const ok = await cas.verifyIntegrity(manifest);
      const json = program.opts().json;
      if (json) {
        process.stdout.write(
          `${JSON.stringify({ ok, slug: manifest.slug, chunks: manifest.chunks.length })}\n`
        );
      } else {
        process.stdout.write(ok ? 'ok\n' : `fail: ${manifest.slug}\n`);
      }
      if (!ok) {
        process.exitCode = 1;
      }
    }, getJson)
  );

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------
program
  .command('doctor')
  .description('Inspect vault health and surface integrity issues')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(
    runAction(async (/** @type {Record<string, any>} */ opts) => {
      const cas = createCas(opts.cwd);
      const report = await inspectVaultHealth(cas);
      const json = program.opts().json;

      if (json) {
        process.stdout.write(`${JSON.stringify(report)}\n`);
      } else {
        process.stdout.write(renderDoctorReport(report));
      }

      if (report.status !== 'ok') {
        process.exitCode = 1;
      }
    }, getJson)
  );

// ---------------------------------------------------------------------------
// vault init
// ---------------------------------------------------------------------------
const vault = program.command('vault').description('Manage the CAS vault');

vault
  .command('init')
  .description('Initialize the vault')
  .option(
    '--vault-passphrase <pass>',
    'Passphrase for vault-level encryption (prefer GIT_CAS_PASSPHRASE env var)'
  )
  .option('--vault-passphrase-file <path>', 'Read vault passphrase from file (use - for stdin)')
  .option(
    '--os-keychain-target <target>',
    'Read vault passphrase from OS keychain target via @git-stunts/vault'
  )
  .option(
    '--os-keychain-account <account>',
    'OS keychain account namespace for --os-keychain-target (default: git-cas)'
  )
  .addOption(new Option('--algorithm <alg>', 'KDF algorithm').choices(['pbkdf2', 'scrypt']))
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(
    runAction(async (/** @type {Record<string, any>} */ opts) => {
      validateCredentialSources(opts);
      const cas = createCas(opts.cwd);
      /** @type {{ passphrase?: string, kdfOptions?: { algorithm: 'pbkdf2' | 'scrypt' } }} */
      const initOpts = {};
      const passphrase = await resolvePassphrase(opts, { confirm: true });
      if (!passphrase && opts.algorithm !== undefined) {
        throw new Error(
          'Provide --vault-passphrase, --vault-passphrase-file, or --os-keychain-target when using --algorithm'
        );
      }
      if (passphrase) {
        initOpts.passphrase = passphrase;
        initOpts.kdfOptions = {
          algorithm: /** @type {'pbkdf2' | 'scrypt'} */ (opts.algorithm || 'pbkdf2'),
        };
      }
      const { commitOid } = await cas.initVault(initOpts);
      const json = program.opts().json;
      if (json) {
        process.stdout.write(`${JSON.stringify({ commitOid })}\n`);
      } else {
        process.stdout.write(`${commitOid}\n`);
      }
    }, getJson)
  );

// ---------------------------------------------------------------------------
// vault list
// ---------------------------------------------------------------------------
vault
  .command('list')
  .description('List vault entries')
  .option('--filter <pattern>', 'Filter entries by glob pattern')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(
    runAction(async (/** @type {Record<string, any>} */ opts) => {
      const cas = createCas(opts.cwd);
      const all = await cas.listVault();
      const entries = filterEntries(all, opts.filter);
      const json = program.opts().json;
      if (json) {
        process.stdout.write(`${JSON.stringify(entries)}\n`);
      } else if (process.stdout.isTTY) {
        process.stdout.write(formatTable(entries));
      } else {
        process.stdout.write(formatTabSeparated(entries));
      }
    }, getJson)
  );

// ---------------------------------------------------------------------------
// vault stats
// ---------------------------------------------------------------------------
vault
  .command('stats')
  .description('Summarize vault size, dedupe, and encryption coverage')
  .option('--filter <pattern>', 'Filter entries by glob pattern')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(
    runAction(async (/** @type {Record<string, any>} */ opts) => {
      const cas = createCas(opts.cwd);
      const all = await cas.listVault();
      const entries = filterEntries(all, opts.filter);
      const records = [];
      for (const entry of entries) {
        const manifest = await cas.readManifest({ treeOid: entry.treeOid });
        records.push({ ...entry, manifest });
      }
      const stats = buildVaultStats(records);
      const json = program.opts().json;
      if (json) {
        process.stdout.write(`${JSON.stringify(stats)}\n`);
      } else {
        process.stdout.write(renderVaultStats(stats));
      }
    }, getJson)
  );

// ---------------------------------------------------------------------------
// vault remove
// ---------------------------------------------------------------------------
vault
  .command('remove <slug>')
  .description('Remove an entry from the vault')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(
    runAction(async (/** @type {string} */ slug, /** @type {Record<string, any>} */ opts) => {
      const cas = createCas(opts.cwd);
      const { commitOid, removedTreeOid } = await cas.removeFromVault({ slug });
      const json = program.opts().json;
      if (json) {
        process.stdout.write(`${JSON.stringify({ commitOid, removedTreeOid })}\n`);
      } else {
        process.stdout.write(`${removedTreeOid}\n`);
      }
    }, getJson)
  );

// ---------------------------------------------------------------------------
// vault info
// ---------------------------------------------------------------------------
vault
  .command('info <slug>')
  .description('Show info for a vault entry')
  .option('--encryption', 'Show vault encryption details')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(
    runAction(async (/** @type {string} */ slug, /** @type {Record<string, any>} */ opts) => {
      const cas = createCas(opts.cwd);
      const treeOid = await cas.resolveVaultEntry({ slug });
      const json = program.opts().json;
      if (json) {
        /** @type {Record<string, any>} */
        const result = { slug, treeOid };
        if (opts.encryption) {
          const metadata = await cas.getVaultMetadata();
          if (metadata?.encryption) {
            result.encryption = metadata.encryption;
          }
        }
        process.stdout.write(`${JSON.stringify(result)}\n`);
      } else {
        process.stdout.write(`slug\t${slug}\n`);
        process.stdout.write(`tree\t${treeOid}\n`);
        if (opts.encryption) {
          const metadata = await cas.getVaultMetadata();
          process.stdout.write(`\n${renderEncryptionCard({ metadata })}\n`);
        }
      }
    }, getJson)
  );

// ---------------------------------------------------------------------------
// vault history
// ---------------------------------------------------------------------------
vault
  .command('history')
  .description('Show vault commit history')
  .option('--cwd <dir>', 'Git working directory', '.')
  .option('-n, --max-count <n>', 'Limit number of commits')
  .option('--pretty', 'Render as color-coded timeline')
  .action(
    runAction(async (/** @type {Record<string, any>} */ opts) => {
      const plumbing = createGitPlumbing({ cwd: opts.cwd || '.' });
      const args = ['log', '--oneline', ContentAddressableStore.VAULT_REF];
      if (opts.maxCount) {
        const n = parseInt(opts.maxCount, 10);
        if (Number.isNaN(n) || n <= 0) {
          throw new Error('--max-count must be a positive integer');
        }
        args.push(`-${n}`);
      }
      const output = await plumbing.execute({ args });
      const json = program.opts().json;
      if (json) {
        const history = output
          .split('\n')
          .filter(Boolean)
          .map((/** @type {string} */ line) => {
            const [commitOid, ...messageParts] = line.trim().split(/\s+/);
            return { commitOid, message: messageParts.join(' ') };
          });
        process.stdout.write(`${JSON.stringify(history)}\n`);
      } else if (opts.pretty && process.stdout.isTTY) {
        process.stdout.write(`${renderHistoryTimeline(output)}\n`);
      } else {
        process.stdout.write(`${output}\n`);
      }
    }, getJson)
  );

// ---------------------------------------------------------------------------
// vault rotate
// ---------------------------------------------------------------------------
/**
 * Resolve old and new passphrases for vault rotate from flags/files.
 *
 * @param {Record<string, any>} opts
 * @returns {Promise<{ oldPassphrase: string, newPassphrase: string }>}
 */
async function resolveRotatePassphrases(opts) {
  if (opts.oldPassphraseFile === '-' && opts.newPassphraseFile === '-') {
    throw new Error('Cannot read both old and new passphrase from stdin');
  }
  const oldPassphrase = opts.oldPassphraseFile
    ? await readPassphraseFile(opts.oldPassphraseFile)
    : opts.oldPassphrase;
  const newPassphrase = opts.newPassphraseFile
    ? await readPassphraseFile(opts.newPassphraseFile)
    : opts.newPassphrase;
  if (!oldPassphrase || !oldPassphrase.trim()) {
    throw new Error('Old passphrase required (--old-passphrase or --old-passphrase-file)');
  }
  if (!newPassphrase || !newPassphrase.trim()) {
    throw new Error('New passphrase required (--new-passphrase or --new-passphrase-file)');
  }
  return { oldPassphrase, newPassphrase };
}

vault
  .command('rotate')
  .description('Rotate vault-level encryption passphrase')
  .option('--old-passphrase <pass>', 'Current vault passphrase')
  .option('--new-passphrase <pass>', 'New vault passphrase')
  .option('--old-passphrase-file <path>', 'Read old passphrase from file (- for stdin)')
  .option('--new-passphrase-file <path>', 'Read new passphrase from file (- for stdin)')
  .addOption(new Option('--algorithm <alg>', 'KDF algorithm').choices(['pbkdf2', 'scrypt']))
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(
    runAction(async (/** @type {Record<string, any>} */ opts) => {
      const { oldPassphrase, newPassphrase } = await resolveRotatePassphrases(opts);
      const cas = createCas(opts.cwd);
      /** @type {{ oldPassphrase: string, newPassphrase: string, kdfOptions?: { algorithm: 'pbkdf2' | 'scrypt' } }} */
      const rotateOpts = {
        oldPassphrase,
        newPassphrase,
      };
      if (opts.algorithm) {
        rotateOpts.kdfOptions = { algorithm: /** @type {'pbkdf2' | 'scrypt'} */ (opts.algorithm) };
      }
      const { commitOid, rotatedSlugs, skippedSlugs } = await cas.rotateVaultPassphrase(rotateOpts);
      const json = program.opts().json;
      if (json) {
        process.stdout.write(`${JSON.stringify({ commitOid, rotatedSlugs, skippedSlugs })}\n`);
      } else {
        process.stdout.write(`${commitOid}\n`);
        if (rotatedSlugs.length) {
          process.stderr.write(`rotated: ${rotatedSlugs.join(', ')}\n`);
        }
        if (skippedSlugs.length) {
          process.stderr.write(`skipped: ${skippedSlugs.join(', ')}\n`);
        }
      }
    }, getJson)
  );

// ---------------------------------------------------------------------------
// vault dashboard
// ---------------------------------------------------------------------------
vault
  .command('dashboard')
  .description('Interactive CAS explorer')
  .option('--cwd <dir>', 'Git working directory', '.')
  .option(
    '--ref <gitRef>',
    'Inspect a git ref that points to a CAS tree, CAS index blob, or commit with a manifest hint'
  )
  .option('--oid <treeOid>', 'Inspect a direct CAS tree OID')
  .action(
    runAction(async (/** @type {Record<string, any>} */ opts) => {
      if (opts.ref && opts.oid) {
        throw new Error('Choose either --ref or --oid, not both');
      }
      const cas = createCas(opts.cwd);
      const { launchDashboard } = await import('./ui/dashboard.js');
      const source = opts.ref
        ? { type: 'ref', ref: opts.ref }
        : opts.oid
          ? { type: 'oid', treeOid: opts.oid }
          : { type: 'vault' };
      await launchDashboard(cas, { cwd: path.resolve(opts.cwd), source });
    }, getJson)
  );

// ---------------------------------------------------------------------------
// rotate
// ---------------------------------------------------------------------------
program
  .command('rotate')
  .description('Rotate an encryption key without re-encrypting data')
  .option('--slug <slug>', 'Resolve tree OID from vault slug')
  .option('--oid <tree-oid>', 'Direct tree OID')
  .requiredOption('--old-key-file <path>', 'Path to current 32-byte key file')
  .requiredOption('--new-key-file <path>', 'Path to new 32-byte key file')
  .option('--label <label>', 'Rotate only the named recipient')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(
    runAction(async (/** @type {Record<string, any>} */ opts) => {
      validateRestoreFlags(opts);
      const cas = createCas(opts.cwd);
      const treeOid = opts.oid || (await cas.resolveVaultEntry({ slug: opts.slug }));
      const manifest = await cas.readManifest({ treeOid });

      const oldKey = readKeyFile(opts.oldKeyFile);
      const newKey = readKeyFile(opts.newKeyFile);

      /** @type {{ manifest: Manifest, oldKey: Buffer, newKey: Buffer, label?: string }} */
      const rotateOpts = { manifest, oldKey, newKey };
      if (opts.label) {
        rotateOpts.label = opts.label;
      }

      const updated = await cas.rotateKey(rotateOpts);
      const json = program.opts().json;

      if (opts.slug) {
        const newTreeOid = await cas.createTree({ manifest: updated });
        await cas.addToVault({ slug: opts.slug, treeOid: newTreeOid, force: true });
        if (json) {
          process.stdout.write(
            `${JSON.stringify({ treeOid: newTreeOid, keyVersion: updated.encryption?.keyVersion })}\n`
          );
        } else {
          process.stdout.write(`${newTreeOid}\n`);
        }
      } else if (json) {
        process.stdout.write(`${JSON.stringify(updated.toJSON())}\n`);
      } else {
        process.stdout.write(`${JSON.stringify(updated.toJSON(), null, 2)}\n`);
      }
    }, getJson)
  );

// ---------------------------------------------------------------------------
// recipient add / remove / list
// ---------------------------------------------------------------------------
const recipient = program.command('recipient').description('Manage envelope encryption recipients');

recipient
  .command('add <slug>')
  .description('Add a recipient to an envelope-encrypted asset')
  .requiredOption('--label <label>', 'Label for the new recipient')
  .requiredOption('--key-file <path>', 'Path to 32-byte key file for the new recipient')
  .requiredOption('--existing-key-file <path>', 'Path to key file of an existing recipient')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(
    runAction(async (/** @type {string} */ slug, /** @type {Record<string, any>} */ opts) => {
      const cas = createCas(opts.cwd);
      const treeOid = await cas.resolveVaultEntry({ slug });
      const manifest = await cas.readManifest({ treeOid });

      const existingKey = readKeyFile(opts.existingKeyFile);
      const newRecipientKey = readKeyFile(opts.keyFile);

      const updated = await cas.addRecipient({
        manifest,
        existingKey,
        newRecipientKey,
        label: opts.label,
      });

      const newTreeOid = await cas.createTree({ manifest: updated });
      await cas.addToVault({ slug, treeOid: newTreeOid, force: true });

      const json = program.opts().json;
      if (json) {
        process.stdout.write(`${JSON.stringify({ treeOid: newTreeOid })}\n`);
      } else {
        process.stdout.write(`${newTreeOid}\n`);
      }
    }, getJson)
  );

recipient
  .command('remove <slug>')
  .description('Remove a recipient from an envelope-encrypted asset')
  .requiredOption('--label <label>', 'Label of the recipient to remove')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(
    runAction(async (/** @type {string} */ slug, /** @type {Record<string, any>} */ opts) => {
      const cas = createCas(opts.cwd);
      const treeOid = await cas.resolveVaultEntry({ slug });
      const manifest = await cas.readManifest({ treeOid });

      const updated = await cas.removeRecipient({ manifest, label: opts.label });

      const newTreeOid = await cas.createTree({ manifest: updated });
      await cas.addToVault({ slug, treeOid: newTreeOid, force: true });

      const json = program.opts().json;
      if (json) {
        process.stdout.write(`${JSON.stringify({ treeOid: newTreeOid })}\n`);
      } else {
        process.stdout.write(`${newTreeOid}\n`);
      }
    }, getJson)
  );

recipient
  .command('list <slug>')
  .description('List recipients of an envelope-encrypted asset')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(
    runAction(async (/** @type {string} */ slug, /** @type {Record<string, any>} */ opts) => {
      const cas = createCas(opts.cwd);
      const treeOid = await cas.resolveVaultEntry({ slug });
      const manifest = await cas.readManifest({ treeOid });

      const labels = await cas.listRecipients(manifest);
      const json = program.opts().json;
      if (json) {
        process.stdout.write(`${JSON.stringify(labels)}\n`);
      } else {
        for (const label of labels) {
          process.stdout.write(`${label}\n`);
        }
      }
    }, getJson)
  );

await program.parseAsync();

// Flush stdout/stderr before exiting — spawned git child processes leave
// libuv handles that prevent natural exit in containerized environments.
await flushStdioAndExit();
