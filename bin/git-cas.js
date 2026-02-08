#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { program } from 'commander';
import GitPlumbing, { ShellRunnerFactory } from '@git-stunts/plumbing';
import ContentAddressableStore from '../index.js';
import Manifest from '../src/domain/value-objects/Manifest.js';

program
  .name('git-cas')
  .description('Content Addressable Storage backed by Git')
  .version('2.0.0');

/**
 * Read a 32-byte raw encryption key from a file.
 */
function readKeyFile(keyFilePath) {
  return readFileSync(keyFilePath);
}

/**
 * Create a CAS instance for the given working directory.
 */
function createCas(cwd) {
  const runner = ShellRunnerFactory.create();
  const plumbing = new GitPlumbing({ runner, cwd });
  return new ContentAddressableStore({ plumbing });
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
 * Resolve encryption key from --key-file or --vault-passphrase.
 */
async function resolveEncryptionKey(cas, opts) {
  if (opts.keyFile) {
    return readKeyFile(opts.keyFile);
  }
  if (!opts.vaultPassphrase) {
    return undefined;
  }
  const metadata = await cas.getVaultMetadata();
  if (metadata?.encryption) {
    return deriveVaultKey(cas, metadata, opts.vaultPassphrase);
  }
  return undefined;
}

/**
 * Read the manifest from a tree OID.
 */
async function readManifestFromTree(service, treeOid) {
  const entries = await service.persistence.readTree(treeOid);
  const entry = entries.find((e) => e.name.startsWith('manifest.'));
  if (!entry) {
    process.stderr.write('error: No manifest found in tree\n');
    process.exit(1);
  }
  const blob = await service.persistence.readBlob(entry.oid);
  return new Manifest(service.codec.decode(blob));
}

/**
 * Validate --slug / --oid flags (exactly one required).
 */
function validateRestoreFlags(opts) {
  if (opts.slug && opts.oid) {
    process.stderr.write('error: Provide --slug or --oid, not both\n');
    process.exit(1);
  }
  if (!opts.slug && !opts.oid) {
    process.stderr.write('error: Provide --slug <slug> or --oid <tree-oid>\n');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------
program
  .command('store <file>')
  .description('Store a file into Git CAS')
  .requiredOption('--slug <slug>', 'Asset slug identifier')
  .option('--key-file <path>', 'Path to 32-byte raw encryption key file')
  .option('--tree', 'Also create a Git tree and print its OID')
  .option('--force', 'Overwrite existing vault entry')
  .option('--vault-passphrase <pass>', 'Vault-level passphrase for encryption')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(async (file, opts) => {
    try {
      const cas = createCas(opts.cwd);
      const encryptionKey = await resolveEncryptionKey(cas, opts);
      const storeOpts = { filePath: file, slug: opts.slug };
      if (encryptionKey) {
        storeOpts.encryptionKey = encryptionKey;
      }

      const manifest = await cas.storeFile(storeOpts);

      if (opts.tree) {
        const treeOid = await cas.createTree({ manifest });
        await cas.addToVault({ slug: opts.slug, treeOid, force: !!opts.force });
        process.stdout.write(`${treeOid}\n`);
      } else {
        process.stdout.write(`${JSON.stringify(manifest.toJSON(), null, 2)}\n`);
      }
    } catch (err) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// tree
// ---------------------------------------------------------------------------
program
  .command('tree')
  .description('Create a Git tree from a manifest')
  .requiredOption('--manifest <path>', 'Path to manifest JSON file')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(async (opts) => {
    try {
      const cas = createCas(opts.cwd);
      const raw = readFileSync(opts.manifest, 'utf8');
      const manifest = new Manifest(JSON.parse(raw));
      const treeOid = await cas.createTree({ manifest });
      process.stdout.write(`${treeOid}\n`);
    } catch (err) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exit(1);
    }
  });

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
  .option('--vault-passphrase <pass>', 'Vault-level passphrase for decryption')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(async (opts) => {
    try {
      validateRestoreFlags(opts);
      const cas = createCas(opts.cwd);
      const treeOid = opts.oid || await cas.resolveVaultEntry({ slug: opts.slug });
      const service = await cas.getService();
      const manifest = await readManifestFromTree(service, treeOid);

      const restoreOpts = { manifest };
      const encryptionKey = await resolveEncryptionKey(cas, opts);
      if (encryptionKey) {
        restoreOpts.encryptionKey = encryptionKey;
      }

      const { bytesWritten } = await cas.restoreFile({
        ...restoreOpts,
        outputPath: opts.out,
      });
      process.stdout.write(`${bytesWritten}\n`);
    } catch (err) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// vault init
// ---------------------------------------------------------------------------
const vault = program
  .command('vault')
  .description('Manage the CAS vault');

vault
  .command('init')
  .description('Initialize the vault')
  .option('--vault-passphrase <pass>', 'Passphrase for vault-level encryption')
  .option('--algorithm <alg>', 'KDF algorithm (pbkdf2 or scrypt)', 'pbkdf2')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(async (opts) => {
    try {
      const cas = createCas(opts.cwd);
      const initOpts = {};
      if (opts.vaultPassphrase) {
        initOpts.passphrase = opts.vaultPassphrase;
        initOpts.kdfOptions = { algorithm: opts.algorithm };
      }
      const { commitOid } = await cas.initVault(initOpts);
      process.stdout.write(`${commitOid}\n`);
    } catch (err) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// vault list
// ---------------------------------------------------------------------------
vault
  .command('list')
  .description('List vault entries')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(async (opts) => {
    try {
      const cas = createCas(opts.cwd);
      const entries = await cas.listVault();
      for (const { slug, treeOid } of entries) {
        process.stdout.write(`${slug}\t${treeOid}\n`);
      }
    } catch (err) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// vault remove
// ---------------------------------------------------------------------------
vault
  .command('remove <slug>')
  .description('Remove an entry from the vault')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(async (slug, opts) => {
    try {
      const cas = createCas(opts.cwd);
      const { removedTreeOid } = await cas.removeFromVault({ slug });
      process.stdout.write(`${removedTreeOid}\n`);
    } catch (err) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exit(1);
    }
  });

program.parse();
