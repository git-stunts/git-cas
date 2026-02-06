#!/usr/bin/env node
/**
 * Progress tracking demonstration using EventEmitter
 *
 * This example shows:
 * 1. Accessing the CasService to attach event listeners
 * 2. Tracking chunk-by-chunk progress during store
 * 3. Tracking chunk-by-chunk progress during restore
 * 4. Building a real-time progress indicator
 * 5. Monitoring integrity verification events
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import GitPlumbing from '@git-stunts/plumbing';
import ContentAddressableStore from '@git-stunts/git-cas';

console.log('=== Progress Tracking Example ===\n');

// Create a temporary bare Git repository
const repoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-progress-'));
console.log(`Created temporary repository: ${repoDir}`);
execSync('git init --bare', { cwd: repoDir, stdio: 'ignore' });

// Initialize plumbing and CAS
const plumbing = GitPlumbing.createDefault({ cwd: repoDir });
const cas = ContentAddressableStore.createJson({ plumbing, chunkSize: 128 * 1024 }); // 128 KB chunks

// Create a larger test file to see multiple chunks
const testDir = mkdtempSync(path.join(os.tmpdir(), 'cas-test-'));
const testFilePath = path.join(testDir, 'large-file.bin');
const fileSize = 1024 * 1024; // 1 MB (will be ~8 chunks at 128 KB)
const originalContent = randomBytes(fileSize);
writeFileSync(testFilePath, originalContent);

console.log(`Created test file: ${testFilePath}`);
console.log(`File size: ${fileSize.toLocaleString()} bytes`);
console.log(`Chunk size: ${(128 * 1024).toLocaleString()} bytes`);
console.log(`Expected chunks: ~${Math.ceil(fileSize / (128 * 1024))}`);

// Get the CasService to attach event listeners
const service = await cas.getService();

// Progress tracker state
const progress = {
  store: { chunks: 0, bytes: 0 },
  restore: { chunks: 0, bytes: 0 }
};

// Event listeners for storage operations
console.log('\n--- Setting up event listeners ---');

service.on('chunk:stored', (event) => {
  progress.store.chunks++;
  progress.store.bytes += event.size;
  console.log(`[STORE] Chunk ${event.index} stored: ${event.size.toLocaleString()} bytes (digest: ${event.digest.substring(0, 8)}...)`);
});

service.on('file:stored', (event) => {
  console.log(`[STORE] File complete: ${event.slug}`);
  console.log(`  Total size: ${event.size.toLocaleString()} bytes`);
  console.log(`  Total chunks: ${event.chunkCount}`);
  console.log(`  Encrypted: ${event.encrypted ? 'Yes' : 'No'}`);
});

service.on('chunk:restored', (event) => {
  progress.restore.chunks++;
  progress.restore.bytes += event.size;
  console.log(`[RESTORE] Chunk ${event.index} restored: ${event.size.toLocaleString()} bytes (digest: ${event.digest.substring(0, 8)}...)`);
});

service.on('file:restored', (event) => {
  console.log(`[RESTORE] File complete: ${event.slug}`);
  console.log(`  Total size: ${event.size.toLocaleString()} bytes`);
  console.log(`  Total chunks: ${event.chunkCount}`);
});

service.on('integrity:pass', (event) => {
  console.log(`[INTEGRITY] Passed for: ${event.slug}`);
});

service.on('integrity:fail', (event) => {
  console.error(`[INTEGRITY] FAILED for: ${event.slug}`);
  console.error(`  Chunk index: ${event.chunkIndex}`);
  console.error(`  Expected: ${event.expected}`);
  console.error(`  Actual: ${event.actual}`);
});

service.on('error', (event) => {
  console.error(`[ERROR] ${event.code}: ${event.message}`);
});

console.log('Event listeners attached:');
console.log('  - chunk:stored');
console.log('  - file:stored');
console.log('  - chunk:restored');
console.log('  - file:restored');
console.log('  - integrity:pass');
console.log('  - integrity:fail');
console.log('  - error');

// Step 1: Store the file with progress tracking
console.log('\n--- Step 1: Storing file (watch for chunk events) ---\n');
const startStore = Date.now();
const manifest = await cas.storeFile({
  filePath: testFilePath,
  slug: 'progress-demo',
  filename: 'large-file.bin'
});
const storeTime = Date.now() - startStore;

console.log(`\nStorage completed in ${storeTime}ms`);
console.log(`Chunks stored: ${progress.store.chunks}`);
console.log(`Bytes processed: ${progress.store.bytes.toLocaleString()}`);
console.log(`Average chunk size: ${Math.round(progress.store.bytes / progress.store.chunks).toLocaleString()} bytes`);

// Calculate storage throughput
const storeThroughputMBps = (progress.store.bytes / 1024 / 1024) / (storeTime / 1000);
console.log(`Throughput: ${storeThroughputMBps.toFixed(2)} MB/s`);

// Step 2: Restore the file with progress tracking
console.log('\n--- Step 2: Restoring file (watch for chunk events) ---\n');
const startRestore = Date.now();
const { buffer, bytesWritten } = await cas.restore({ manifest });
const restoreTime = Date.now() - startRestore;

console.log(`\nRestore completed in ${restoreTime}ms`);
console.log(`Chunks restored: ${progress.restore.chunks}`);
console.log(`Bytes processed: ${progress.restore.bytes.toLocaleString()}`);
console.log(`Bytes written: ${bytesWritten.toLocaleString()}`);

// Calculate restore throughput
const restoreThroughputMBps = (progress.restore.bytes / 1024 / 1024) / (restoreTime / 1000);
console.log(`Throughput: ${restoreThroughputMBps.toFixed(2)} MB/s`);

// Verify content
const contentMatches = buffer.equals(originalContent);
console.log(`Content verification: ${contentMatches ? 'PASSED' : 'FAILED'}`);

if (!contentMatches) {
  console.error('ERROR: Content mismatch!');
  process.exit(1);
}

// Step 3: Run integrity verification with events
console.log('\n--- Step 3: Integrity verification (watch for events) ---\n');
const startVerify = Date.now();
const isValid = await cas.verifyIntegrity(manifest);
const verifyTime = Date.now() - startVerify;

console.log(`\nIntegrity verification completed in ${verifyTime}ms`);
console.log(`Result: ${isValid ? 'PASSED' : 'FAILED'}`);

if (!isValid) {
  console.error('ERROR: Integrity check failed!');
  process.exit(1);
}

// Step 4: Build a more sophisticated progress indicator
console.log('\n--- Step 4: Advanced progress tracking ---');
console.log('\nStoring another file with percentage progress...\n');

// Reset progress counters
let storeChunkCount = 0;
let totalChunks = 0;

// Create a new event listener for percentage progress
const progressListener = (event) => {
  storeChunkCount++;
  if (totalChunks === 0) {
    // First chunk - estimate total chunks
    totalChunks = Math.ceil(fileSize / (128 * 1024));
  }
  const percentage = Math.min(100, Math.round((storeChunkCount / totalChunks) * 100));
  const progressBar = '='.repeat(Math.floor(percentage / 5)) + ' '.repeat(20 - Math.floor(percentage / 5));
  process.stdout.write(`\rProgress: [${progressBar}] ${percentage}% (${storeChunkCount}/${totalChunks} chunks)`);
};

service.on('chunk:stored', progressListener);

// Store another test file
const testFilePath2 = path.join(testDir, 'progress-demo.bin');
writeFileSync(testFilePath2, randomBytes(fileSize));

const manifest2 = await cas.storeFile({
  filePath: testFilePath2,
  slug: 'progress-demo-2',
  filename: 'progress-demo.bin'
});

console.log('\n\nProgress tracking complete!');
console.log(`Final chunk count: ${storeChunkCount}`);

// Remove the progress listener to avoid cluttering output
service.removeListener('chunk:stored', progressListener);

// Summary statistics
console.log('\n--- Performance Summary ---');
console.log('Storage operation:');
console.log(`  Time: ${storeTime}ms`);
console.log(`  Throughput: ${storeThroughputMBps.toFixed(2)} MB/s`);
console.log(`  Chunks: ${progress.store.chunks}`);

console.log('\nRestore operation:');
console.log(`  Time: ${restoreTime}ms`);
console.log(`  Throughput: ${restoreThroughputMBps.toFixed(2)} MB/s`);
console.log(`  Chunks: ${progress.restore.chunks}`);

console.log('\nIntegrity verification:');
console.log(`  Time: ${verifyTime}ms`);

// Cleanup
console.log('\n--- Cleanup ---');
rmSync(testDir, { recursive: true, force: true });
rmSync(repoDir, { recursive: true, force: true });
console.log('Temporary files removed');

console.log('\n=== Example completed successfully! ===');
console.log('\nKey takeaways:');
console.log('- Access CasService via cas.getService() for events');
console.log('- chunk:stored fires for each chunk during storage');
console.log('- chunk:restored fires for each chunk during restore');
console.log('- file:stored and file:restored fire when operations complete');
console.log('- Events can be used to build progress bars and monitors');
console.log('- Remove listeners with removeListener() to avoid memory leaks');
