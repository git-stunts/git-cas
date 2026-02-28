#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { program } from 'commander';
import GitPlumbing, { ShellRunnerFactory } from '@git-stunts/plumbing';
import ContentAddressableStore, { EventEmitterObserver } from '../index.js';
import Manifest from '../src/domain/value-objects/Manifest.js';
import { createStoreProgress, createRestoreProgress } from './ui/progress.js';
import { renderEncryptionCard } from './ui/encryption-card.js';
import { renderHistoryTimeline } from './ui/history-timeline.js';
import { renderManifestView } from './ui/manifest-view.js';
import { renderHeatmap } from './ui/heatmap.js';
import { runAction } from './actions.js';
import { filterEntries, formatTable, formatTabSeparated } from './ui/vault-list.js';

const getJson = () => program.opts().json;

program
  .name('git-cas')
  .description('Content Addressable Storage backed by Git')
  .version('4.0.1')
  .option('-q, --quiet', 'Suppress progress output')
  .option('--json', 'Output results as JSON');

/**
 * Read a 32-byte raw encryption key from a file.
 */
function readKeyFile(keyFilePath) {
  return readFileSync(keyFilePath);
}

/**
 * Create a CAS instance for the given working directory with an optional observability adapter.
 */
function createCas(cwd, { observability } = {}) {
  const runner = ShellRunnerFactory.create();
  const plumbing = new GitPlumbing({ runner, cwd });
  return new ContentAddressableStore({ plumbing, observability });
}

/**
 * Derive the encryption key from vault metadata + passphrase.
 */
async function deriveVaultKey(cas, metadata, passphrase) {
  const { kdf } = metadata.encryption;
  const { key } = await cas.deriveKey({
    passphrase,
    salt: Buffer.from(kdf.salt, 'base64'),
    algorithm: kdf.algorithm,
    iterations: kdf.iterations,
    cost: kdf.cost,
    blockSize: kdf.blockSize,
    parallelization: kdf.parallelization,
  });
  return key;
}

/**
 * Resolve passphrase from --vault-passphrase flag or GIT_CAS_PASSPHRASE env var.
 */
function resolvePassphrase(opts) {
  return opts.vaultPassphrase ?? process.env.GIT_CAS_PASSPHRASE;
}

/**
 * Resolve encryption key from --key-file or --vault-passphrase / GIT_CAS_PASSPHRASE.
 */
async function resolveEncryptionKey(cas, opts) {
  if (opts.keyFile) {
    return readKeyFile(opts.keyFile);
  }
  const passphrase = resolvePassphrase(opts);
  if (!passphrase) {
    return undefined;
  }
  const metadata = await cas.getVaultMetadata();
  if (metadata?.encryption) {
    return deriveVaultKey(cas, metadata, passphrase);
  }
  process.stderr.write('warning: passphrase ignored (vault is not encrypted)\n');
  return undefined;
}

/**
 * Validate --slug / --oid flags (exactly one required).
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
 * Build store options, resolving encryption key or recipients.
 */
async function buildStoreOpts(cas, file, opts) {
  const storeOpts = { filePath: file, slug: opts.slug };
  if (opts.recipient) {
    storeOpts.recipients = opts.recipient;
  } else {
    const encryptionKey = await resolveEncryptionKey(cas, opts);
    if (encryptionKey) { storeOpts.encryptionKey = encryptionKey; }
  }
  return storeOpts;
}

/**
 * Parse a --recipient flag value into { label, key }.
 * Format: label:keyfile
 */
function parseRecipient(value, previous) {
  const sep = value.indexOf(':');
  if (sep < 1) {
    throw new Error(`Invalid --recipient format "${value}": expected label:keyfile`);
  }
  const label = value.slice(0, sep);
  const keyfile = value.slice(sep + 1);
  const key = readKeyFile(keyfile);
  const list = previous || [];
  list.push({ label, key });
  return list;
}

program
  .command('store <file>')
  .description('Store a file into Git CAS')
  .requiredOption('--slug <slug>', 'Asset slug identifier')
  .option('--key-file <path>', 'Path to 32-byte raw encryption key file')
  .option('--recipient <label:keyfile>', 'Envelope recipient (repeatable)', parseRecipient)
  .option('--tree', 'Also create a Git tree and print its OID')
  .option('--force', 'Overwrite existing vault entry')
  .option('--vault-passphrase <pass>', 'Vault-level passphrase for encryption (prefer GIT_CAS_PASSPHRASE env var)')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(runAction(async (file, opts) => {
    if (opts.recipient && opts.keyFile) {
      throw new Error('Provide --key-file or --recipient, not both');
    }
    if (opts.force && !opts.tree) {
      throw new Error('--force requires --tree');
    }
    const json = program.opts().json;
    const quiet = program.opts().quiet || json;
    const observer = new EventEmitterObserver();
    const cas = createCas(opts.cwd, { observability: observer });

    const storeOpts = await buildStoreOpts(cas, file, opts);
    const progress = createStoreProgress({ filePath: file, chunkSize: cas.chunkSize, quiet });
    progress.attach(observer);
    let manifest;
    try { manifest = await cas.storeFile(storeOpts); } finally { progress.detach(); }

    if (opts.tree) {
      const treeOid = await cas.createTree({ manifest });
      await cas.addToVault({ slug: opts.slug, treeOid, force: !!opts.force });
      process.stdout.write(json ? `${JSON.stringify({ treeOid })}\n` : `${treeOid}\n`);
    } else {
      const output = json ? JSON.stringify({ manifest: manifest.toJSON() }) : JSON.stringify(manifest.toJSON(), null, 2);
      process.stdout.write(`${output}\n`);
    }
  }, getJson));

// ---------------------------------------------------------------------------
// tree
// ---------------------------------------------------------------------------
program
  .command('tree')
  .description('Create a Git tree from a manifest')
  .requiredOption('--manifest <path>', 'Path to manifest JSON file')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(runAction(async (opts) => {
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
  }, getJson));

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
  .action(runAction(async (opts) => {
    validateRestoreFlags(opts);
    const cas = createCas(opts.cwd);
    const treeOid = opts.oid || await cas.resolveVaultEntry({ slug: opts.slug });
    const manifest = await cas.readManifest({ treeOid });
    const json = program.opts().json;

    if (json) {
      process.stdout.write(`${JSON.stringify(manifest.toJSON())}\n`);
    } else if (opts.heatmap) {
      process.stdout.write(renderHeatmap({ manifest }));
    } else if (process.stdout.isTTY) {
      process.stdout.write(renderManifestView({ manifest }));
    } else {
      process.stdout.write(`${JSON.stringify(manifest.toJSON(), null, 2)}\n`);
    }
  }, getJson));

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
  .option('--vault-passphrase <pass>', 'Vault-level passphrase for decryption (prefer GIT_CAS_PASSPHRASE env var)')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(runAction(async (opts) => {
    validateRestoreFlags(opts);
    const quiet = program.opts().quiet || program.opts().json;
    const observer = new EventEmitterObserver();
    const cas = createCas(opts.cwd, { observability: observer });
    const treeOid = opts.oid || await cas.resolveVaultEntry({ slug: opts.slug });
    const manifest = await cas.readManifest({ treeOid });

    const restoreOpts = { manifest };
    const encryptionKey = await resolveEncryptionKey(cas, opts);
    if (encryptionKey) {
      restoreOpts.encryptionKey = encryptionKey;
    }

    const progress = createRestoreProgress({
      totalChunks: manifest.chunks.length, quiet,
    });
    progress.attach(observer);
    let bytesWritten;
    try {
      ({ bytesWritten } = await cas.restoreFile({
        ...restoreOpts,
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
  }, getJson));

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------
program
  .command('verify')
  .description('Verify integrity of a stored asset (checks blob hashes; no key needed)')
  .option('--slug <slug>', 'Resolve tree OID from vault slug')
  .option('--oid <tree-oid>', 'Direct tree OID')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(runAction(async (opts) => {
    validateRestoreFlags(opts);
    const cas = createCas(opts.cwd);
    const treeOid = opts.oid || await cas.resolveVaultEntry({ slug: opts.slug });
    const manifest = await cas.readManifest({ treeOid });
    const ok = await cas.verifyIntegrity(manifest);
    const json = program.opts().json;
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok, slug: manifest.slug, chunks: manifest.chunks.length })}\n`);
    } else {
      process.stdout.write(ok ? 'ok\n' : `fail: ${manifest.slug}\n`);
    }
    if (!ok) {
      process.exitCode = 1;
    }
  }, getJson));

// ---------------------------------------------------------------------------
// vault init
// ---------------------------------------------------------------------------
const vault = program
  .command('vault')
  .description('Manage the CAS vault');

vault
  .command('init')
  .description('Initialize the vault')
  .option('--vault-passphrase <pass>', 'Passphrase for vault-level encryption (prefer GIT_CAS_PASSPHRASE env var)')
  .option('--algorithm <alg>', 'KDF algorithm (pbkdf2 or scrypt)', 'pbkdf2')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(runAction(async (opts) => {
    const cas = createCas(opts.cwd);
    const initOpts = {};
    const passphrase = resolvePassphrase(opts);
    if (passphrase) {
      initOpts.passphrase = passphrase;
      initOpts.kdfOptions = { algorithm: opts.algorithm };
    }
    const { commitOid } = await cas.initVault(initOpts);
    const json = program.opts().json;
    if (json) {
      process.stdout.write(`${JSON.stringify({ commitOid })}\n`);
    } else {
      process.stdout.write(`${commitOid}\n`);
    }
  }, getJson));

// ---------------------------------------------------------------------------
// vault list
// ---------------------------------------------------------------------------
vault
  .command('list')
  .description('List vault entries')
  .option('--filter <pattern>', 'Filter entries by glob pattern')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(runAction(async (opts) => {
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
  }, getJson));

// ---------------------------------------------------------------------------
// vault remove
// ---------------------------------------------------------------------------
vault
  .command('remove <slug>')
  .description('Remove an entry from the vault')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(runAction(async (slug, opts) => {
    const cas = createCas(opts.cwd);
    const { commitOid, removedTreeOid } = await cas.removeFromVault({ slug });
    const json = program.opts().json;
    if (json) {
      process.stdout.write(`${JSON.stringify({ commitOid, removedTreeOid })}\n`);
    } else {
      process.stdout.write(`${removedTreeOid}\n`);
    }
  }, getJson));

// ---------------------------------------------------------------------------
// vault info
// ---------------------------------------------------------------------------
vault
  .command('info <slug>')
  .description('Show info for a vault entry')
  .option('--encryption', 'Show vault encryption details')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(runAction(async (slug, opts) => {
    const cas = createCas(opts.cwd);
    const treeOid = await cas.resolveVaultEntry({ slug });
    const json = program.opts().json;
    if (json) {
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
  }, getJson));

// ---------------------------------------------------------------------------
// vault history
// ---------------------------------------------------------------------------
vault
  .command('history')
  .description('Show vault commit history')
  .option('--cwd <dir>', 'Git working directory', '.')
  .option('-n, --max-count <n>', 'Limit number of commits')
  .option('--pretty', 'Render as color-coded timeline')
  .action(runAction(async (opts) => {
    const runner = ShellRunnerFactory.create();
    const plumbing = new GitPlumbing({ runner, cwd: opts.cwd || '.' });
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
        .map((line) => {
          const [commitOid, ...messageParts] = line.trim().split(/\s+/);
          return { commitOid, message: messageParts.join(' ') };
        });
      process.stdout.write(`${JSON.stringify(history)}\n`);
    } else if (opts.pretty && process.stdout.isTTY) {
      process.stdout.write(`${renderHistoryTimeline(output)}\n`);
    } else {
      process.stdout.write(`${output}\n`);
    }
  }, getJson));

// ---------------------------------------------------------------------------
// vault dashboard
// ---------------------------------------------------------------------------
vault
  .command('dashboard')
  .description('Interactive vault explorer')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(runAction(async (opts) => {
    const cas = createCas(opts.cwd);
    const { launchDashboard } = await import('./ui/dashboard.js');
    await launchDashboard(cas);
  }, getJson));

// ---------------------------------------------------------------------------
// recipient add / remove / list
// ---------------------------------------------------------------------------
const recipient = program
  .command('recipient')
  .description('Manage envelope encryption recipients');

recipient
  .command('add <slug>')
  .description('Add a recipient to an envelope-encrypted asset')
  .requiredOption('--label <label>', 'Label for the new recipient')
  .requiredOption('--key-file <path>', 'Path to 32-byte key file for the new recipient')
  .requiredOption('--existing-key-file <path>', 'Path to key file of an existing recipient')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(runAction(async (slug, opts) => {
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
  }, getJson));

recipient
  .command('remove <slug>')
  .description('Remove a recipient from an envelope-encrypted asset')
  .requiredOption('--label <label>', 'Label of the recipient to remove')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(runAction(async (slug, opts) => {
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
  }, getJson));

recipient
  .command('list <slug>')
  .description('List recipients of an envelope-encrypted asset')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(runAction(async (slug, opts) => {
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
  }, getJson));

await program.parseAsync();