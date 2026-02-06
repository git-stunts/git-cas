#!/usr/bin/env node
/**
 * Encrypted workflow demonstration
 *
 * This example shows:
 * 1. Generating a secure encryption key
 * 2. Storing a file with encryption
 * 3. Restoring with the correct key
 * 4. Demonstrating what happens with the wrong key
 * 5. Inspecting encryption metadata
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import GitPlumbing from '@git-stunts/plumbing';
import ContentAddressableStore from '@git-stunts/git-cas';

console.log('=== Encrypted Workflow Example ===\n');

// Create a temporary bare Git repository
const repoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-encrypted-'));
console.log(`Created temporary repository: ${repoDir}`);
execSync('git init --bare', { cwd: repoDir, stdio: 'ignore' });

// Initialize plumbing and CAS
const plumbing = GitPlumbing.createDefault({ cwd: repoDir });
const cas = ContentAddressableStore.createJson({ plumbing });

// Create a test file with sensitive content
const testDir = mkdtempSync(path.join(os.tmpdir(), 'cas-test-'));
const testFilePath = path.join(testDir, 'sensitive.txt');
const secretContent = Buffer.from('This is sensitive information that should be encrypted.');
writeFileSync(testFilePath, secretContent);

console.log(`Created test file: ${testFilePath}`);
console.log(`Content: "${secretContent.toString()}"`);
console.log(`Size: ${secretContent.length} bytes`);

// Step 1: Generate a secure encryption key
console.log('\n--- Step 1: Generating encryption key ---');
const encryptionKey = randomBytes(32);
console.log(`Generated 32-byte encryption key: ${encryptionKey.toString('hex').substring(0, 16)}...`);
console.log(`Key size: ${encryptionKey.length} bytes (256 bits)`);
console.log('Encryption algorithm: AES-256-GCM');

// Step 2: Store the file with encryption
console.log('\n--- Step 2: Storing encrypted file ---');
const manifest = await cas.storeFile({
  filePath: testFilePath,
  slug: 'encrypted-secret',
  filename: 'sensitive.txt',
  encryptionKey
});

console.log('File stored with encryption!');
console.log(`  Slug: ${manifest.slug}`);
console.log(`  Size: ${manifest.size} bytes`);
console.log(`  Chunks: ${manifest.chunks.length}`);
console.log(`  Encrypted: ${manifest.encryption?.encrypted ? 'YES' : 'NO'}`);

// Step 3: Inspect encryption metadata
console.log('\n--- Step 3: Encryption metadata ---');
if (manifest.encryption?.encrypted) {
  console.log('Encryption details:');
  console.log(`  Algorithm: ${manifest.encryption.algorithm || 'AES-256-GCM'}`);
  console.log(`  IV length: ${manifest.encryption.iv?.length || 0} bytes`);
  console.log(`  Auth tag length: ${manifest.encryption.authTag?.length || 0} bytes`);

  if (manifest.encryption.iv) {
    console.log(`  IV (hex): ${Buffer.from(manifest.encryption.iv).toString('hex')}`);
  }
} else {
  console.error('ERROR: File was not encrypted!');
  process.exit(1);
}

// Create a Git tree to persist the manifest
const treeOid = await cas.createTree({ manifest });
console.log(`\nGit tree created: ${treeOid}`);

// Step 4: Restore with the correct key
console.log('\n--- Step 4: Restoring with correct key ---');
try {
  const { buffer } = await cas.restore({
    manifest,
    encryptionKey
  });

  const decryptedContent = buffer.toString();
  console.log('Decryption successful!');
  console.log(`Restored content: "${decryptedContent}"`);
  console.log(`Content matches: ${buffer.equals(secretContent) ? 'YES' : 'NO'}`);

  if (!buffer.equals(secretContent)) {
    console.error('ERROR: Decrypted content does not match original!');
    process.exit(1);
  }
} catch (err) {
  console.error(`Decryption failed: ${err.message}`);
  process.exit(1);
}

// Step 5: Demonstrate wrong key failure
console.log('\n--- Step 5: Attempting restore with wrong key ---');
const wrongKey = randomBytes(32);
console.log(`Wrong key (hex): ${wrongKey.toString('hex').substring(0, 16)}...`);

try {
  await cas.restore({
    manifest,
    encryptionKey: wrongKey
  });

  // If we get here, something is wrong
  console.error('ERROR: Decryption should have failed with wrong key!');
  process.exit(1);
} catch (err) {
  console.log('Decryption correctly failed!');
  console.log(`Error type: ${err.constructor.name}`);
  console.log(`Error code: ${err.code}`);
  console.log(`Error message: ${err.message}`);

  if (err.code !== 'INTEGRITY_ERROR') {
    console.warn(`Warning: Expected error code 'INTEGRITY_ERROR', got '${err.code}'`);
  }
}

// Step 6: Demonstrate missing key error
console.log('\n--- Step 6: Attempting restore without key ---');
try {
  await cas.restore({ manifest });

  console.error('ERROR: Restore should have failed without key!');
  process.exit(1);
} catch (err) {
  console.log('Restore correctly failed!');
  console.log(`Error code: ${err.code}`);
  console.log(`Error message: ${err.message}`);

  if (err.code !== 'MISSING_KEY') {
    console.warn(`Warning: Expected error code 'MISSING_KEY', got '${err.code}'`);
  }
}

// Step 7: Verify integrity of encrypted chunks
console.log('\n--- Step 7: Verifying encrypted chunk integrity ---');
const isValid = await cas.verifyIntegrity(manifest);
console.log(`Integrity check: ${isValid ? 'PASSED' : 'FAILED'}`);
console.log('Note: Integrity check verifies chunk digests, not decryption');

// Cleanup
console.log('\n--- Cleanup ---');
rmSync(testDir, { recursive: true, force: true });
rmSync(repoDir, { recursive: true, force: true });
console.log('Temporary files removed');

console.log('\n=== Example completed successfully! ===');
console.log('\nKey takeaways:');
console.log('- Encryption keys must be exactly 32 bytes (256 bits)');
console.log('- Wrong keys produce INTEGRITY_ERROR during decryption');
console.log('- Missing keys produce MISSING_KEY error');
console.log('- Encryption metadata (IV, auth tag) is stored in the manifest');
console.log('- Chunk integrity is verified independently of encryption');
