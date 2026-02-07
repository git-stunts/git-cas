#!/usr/bin/env node
/**
 * Basic store-and-restore workflow demonstration
 *
 * This example shows the complete lifecycle:
 * 1. Store a file in the CAS
 * 2. Create a Git tree to persist the manifest
 * 3. Read the manifest back from the tree
 * 4. Restore the file to disk
 * 5. Verify the restored content matches the original
 * 6. Run integrity verification
 */

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import GitPlumbing from '@git-stunts/plumbing';
import ContentAddressableStore, { Manifest } from '@git-stunts/git-cas';

console.log('=== Store and Restore Example ===\n');

// Create a temporary bare Git repository
const repoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-example-'));
console.log(`Created temporary repository: ${repoDir}`);
execSync('git init --bare', { cwd: repoDir, stdio: 'ignore' });

// Initialize plumbing and CAS
const plumbing = GitPlumbing.createDefault({ cwd: repoDir });
const cas = ContentAddressableStore.createJson({ plumbing });

// Create a test file with random content
const testDir = mkdtempSync(path.join(os.tmpdir(), 'cas-test-'));
const testFilePath = path.join(testDir, 'sample.bin');
const originalContent = randomBytes(500 * 1024); // 500 KB
writeFileSync(testFilePath, originalContent);

console.log(`\nCreated test file: ${testFilePath}`);
console.log(`File size: ${originalContent.length.toLocaleString()} bytes`);

// Step 1: Store the file
console.log('\n--- Step 1: Storing file ---');
const manifest = await cas.storeFile({
  filePath: testFilePath,
  slug: 'example-file',
  filename: 'sample.bin'
});

console.log(`Stored successfully!`);
console.log(`  Slug: ${manifest.slug}`);
console.log(`  Filename: ${manifest.filename}`);
console.log(`  Size: ${manifest.size.toLocaleString()} bytes`);
console.log(`  Chunks: ${manifest.chunks.length}`);
console.log(`  Encrypted: ${manifest.encryption?.encrypted ? 'Yes' : 'No'}`);

// Step 2: Create a Git tree to persist the manifest
console.log('\n--- Step 2: Creating Git tree ---');
const treeOid = await cas.createTree({ manifest });
console.log(`Git tree created: ${treeOid}`);

// Step 3: Read the manifest back from the tree
console.log('\n--- Step 3: Reading manifest from tree ---');
const service = await cas.getService();
const entries = await service.persistence.readTree(treeOid);

console.log(`Tree contains ${entries.length} entries:`);
entries.forEach(entry => {
  const label = entry.name.startsWith('manifest.') ? 'Manifest' : `Chunk ${entry.name.substring(0, 8)}...`;
  console.log(`  - ${label} (${entry.type}): ${entry.oid}`);
});

// Find and decode the manifest
const manifestEntry = entries.find(e => e.name === 'manifest.json');
if (!manifestEntry) {
  throw new Error('Manifest not found in tree');
}

const manifestBlob = await service.persistence.readBlob(manifestEntry.oid);
const manifestData = service.codec.decode(manifestBlob);
const restoredManifest = new Manifest(manifestData);

console.log('\nManifest successfully read from tree');
console.log(`  Slug: ${restoredManifest.slug}`);
console.log(`  Chunks: ${restoredManifest.chunks.length}`);

// Step 4: Restore the file to disk
console.log('\n--- Step 4: Restoring file to disk ---');
const outputPath = path.join(testDir, 'restored.bin');
const { bytesWritten } = await cas.restoreFile({
  manifest: restoredManifest,
  outputPath
});

console.log(`File restored to: ${outputPath}`);
console.log(`Bytes written: ${bytesWritten.toLocaleString()}`);

// Step 5: Verify the restored content matches the original
console.log('\n--- Step 5: Verifying content ---');
const restoredContent = readFileSync(outputPath);

const contentMatches = originalContent.equals(restoredContent);
console.log(`Original size: ${originalContent.length.toLocaleString()} bytes`);
console.log(`Restored size: ${restoredContent.length.toLocaleString()} bytes`);
console.log(`Content matches: ${contentMatches ? 'YES' : 'NO'}`);

if (!contentMatches) {
  console.error('ERROR: Content mismatch!');
  process.exit(1);
}

// Step 6: Run integrity verification
console.log('\n--- Step 6: Integrity verification ---');
const isValid = await cas.verifyIntegrity(restoredManifest);
console.log(`Integrity check: ${isValid ? 'PASSED' : 'FAILED'}`);

if (!isValid) {
  console.error('ERROR: Integrity check failed!');
  process.exit(1);
}

// Cleanup
console.log('\n--- Cleanup ---');
rmSync(testDir, { recursive: true, force: true });
rmSync(repoDir, { recursive: true, force: true });
console.log('Temporary files removed');

console.log('\n=== Example completed successfully! ===');
