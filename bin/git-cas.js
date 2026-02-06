#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { program } from 'commander';
import GitPlumbing from '@git-stunts/plumbing';
import ContentAddressableStore from '../index.js';
import Manifest from '../src/domain/value-objects/Manifest.js';

program
  .name('git-cas')
  .description('Content Addressable Storage backed by Git')
  .version('1.3.0');

/**
 * Read a 32-byte raw encryption key from a file.
 */
function readKeyFile(keyFilePath) {
  const key = readFileSync(keyFilePath);
  return key;
}

/**
 * Create a CAS instance for the given working directory.
 */
function createCas(cwd) {
  const plumbing = new GitPlumbing({ cwd });
  return new ContentAddressableStore({ plumbing });
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
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(async (file, opts) => {
    try {
      const cas = createCas(opts.cwd);
      const storeOpts = {
        filePath: file,
        slug: opts.slug,
      };

      if (opts.keyFile) {
        storeOpts.encryptionKey = readKeyFile(opts.keyFile);
      }

      const manifest = await cas.storeFile(storeOpts);

      if (opts.tree) {
        const treeOid = await cas.createTree({ manifest });
        process.stdout.write(`${treeOid  }\n`);
      } else {
        process.stdout.write(`${JSON.stringify(manifest.toJSON(), null, 2)  }\n`);
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
      process.stdout.write(`${treeOid  }\n`);
    } catch (err) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// restore
// ---------------------------------------------------------------------------
program
  .command('restore <tree-oid>')
  .description('Restore a file from a Git CAS tree')
  .requiredOption('--out <path>', 'Output file path')
  .option('--key-file <path>', 'Path to 32-byte raw encryption key file')
  .option('--cwd <dir>', 'Git working directory', '.')
  .action(async (treeOid, opts) => {
    try {
      const cas = createCas(opts.cwd);
      const service = await cas.getService();

      // Read the tree to find the manifest
      const entries = await service.persistence.readTree(treeOid);
      const manifestEntry = entries.find(
        (e) => e.name.startsWith('manifest.'),
      );
      if (!manifestEntry) {
        process.stderr.write('error: No manifest found in tree\n');
        process.exit(1);
      }

      const manifestBlob = await service.persistence.readBlob(
        manifestEntry.oid,
      );
      const manifest = new Manifest(
        service.codec.decode(manifestBlob),
      );

      const restoreOpts = { manifest };
      if (opts.keyFile) {
        restoreOpts.encryptionKey = readKeyFile(opts.keyFile);
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

program.parse();