/* eslint-disable no-console, max-lines-per-function, no-unused-vars */
import { bench, describe } from 'vitest';
import { createHash } from 'node:crypto';
import CdcChunker from '../../src/infrastructure/chunkers/CdcChunker.js';
import FixedChunker from '../../src/infrastructure/chunkers/FixedChunker.js';

// ---------------------------------------------------------------------------
// Seeded PRNG — reproducible pseudo-random buffers
// ---------------------------------------------------------------------------

/**
 * Simple xorshift128 PRNG for reproducible pseudo-random data.
 * Much faster than crypto.randomBytes, deterministic across runs.
 */
function seededBuffer(size, seed = 42) {
  const buf = Buffer.allocUnsafe(size);
  // xorshift128 state seeded from the seed value
  let s0 = (seed * 2654435761) >>> 0 || 1;
  let s1 = (seed * 2246822519) >>> 0 || 2;
  let s2 = (seed * 3266489917) >>> 0 || 3;
  let s3 = (seed * 668265263) >>> 0 || 4;

  for (let i = 0; i < size; i += 4) {
    const t = (s0 ^ (s0 << 11)) >>> 0;
    s0 = s1;
    s1 = s2;
    s2 = s3;
    s3 = ((s3 ^ (s3 >>> 19)) ^ (t ^ (t >>> 8))) >>> 0;
    // Write up to 4 bytes
    const remaining = size - i;
    if (remaining >= 4) {
      buf.writeUInt32LE(s3, i);
    } else {
      for (let j = 0; j < remaining; j++) {
        buf[i + j] = (s3 >>> (j * 8)) & 0xff;
      }
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wraps a Buffer as an async iterable for the chunker interface.
 * @param {Buffer} buf
 * @returns {AsyncIterable<Buffer>}
 */
async function* bufferToAsyncIterable(buf) {
  yield buf;
}

/**
 * Collects all chunks from a chunker into an array.
 * @param {AsyncIterable<Buffer>} source
 * @returns {Promise<Buffer[]>}
 */
async function collectChunks(source) {
  const chunks = [];
  for await (const chunk of source) {
    chunks.push(chunk);
  }
  return chunks;
}

/**
 * Computes SHA-256 hex digest of a buffer.
 * @param {Buffer} buf
 * @returns {string}
 */
function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Creates a modified copy of a buffer with `editSize` bytes **inserted**
 * at a deterministic position.  Insertion (rather than overwrite) shifts
 * all subsequent data, which is the scenario where CDC's shift-resistant
 * boundaries shine compared to fixed-size chunking.
 *
 * @param {Buffer} original
 * @param {number} editSize  - Number of bytes to insert.
 * @param {number} [insertOffset] - Where to inject the edit (default: ~1/3 into the file).
 * @returns {Buffer}
 */
function createModifiedBuffer(original, editSize, insertOffset) {
  const offset = insertOffset ?? Math.floor(original.length / 3);
  const patch = seededBuffer(editSize, 9999 + editSize);
  return Buffer.concat([
    original.subarray(0, offset),
    patch,
    original.subarray(offset),
  ]);
}

// ---------------------------------------------------------------------------
// Pre-generate test buffers (seeded for reproducibility)
// ---------------------------------------------------------------------------

const buf1MB = seededBuffer(1 * 1024 * 1024, 1);
const buf10MB = seededBuffer(10 * 1024 * 1024, 2);
const buf100MB = seededBuffer(100 * 1024 * 1024, 3);

// Use smaller chunk sizes so we get enough chunks for meaningful dedup stats
// even on 1 MB files.
const CDC_OPTS = { minChunkSize: 4096, maxChunkSize: 65536, targetChunkSize: 16384 };
const FIXED_OPTS = { chunkSize: 16384 };

// ---------------------------------------------------------------------------
// Throughput benchmarks — CDC vs Fixed
// ---------------------------------------------------------------------------

describe('throughput – CDC chunker', () => {
  const chunker = new CdcChunker(CDC_OPTS);

  bench('1 MB', async () => {
    for await (const _c of chunker.chunk(bufferToAsyncIterable(buf1MB))) { /* drain */ }
  });

  bench('10 MB', async () => {
    for await (const _c of chunker.chunk(bufferToAsyncIterable(buf10MB))) { /* drain */ }
  });

  bench('100 MB', async () => {
    for await (const _c of chunker.chunk(bufferToAsyncIterable(buf100MB))) { /* drain */ }
  }, { time: 5000 });
});

describe('throughput – Fixed chunker', () => {
  const chunker = new FixedChunker(FIXED_OPTS);

  bench('1 MB', async () => {
    for await (const _c of chunker.chunk(bufferToAsyncIterable(buf1MB))) { /* drain */ }
  });

  bench('10 MB', async () => {
    for await (const _c of chunker.chunk(bufferToAsyncIterable(buf10MB))) { /* drain */ }
  });

  bench('100 MB', async () => {
    for await (const _c of chunker.chunk(bufferToAsyncIterable(buf100MB))) { /* drain */ }
  }, { time: 5000 });
});

// ---------------------------------------------------------------------------
// Dedup efficiency comparison — CDC vs Fixed
// ---------------------------------------------------------------------------

describe('dedup efficiency – CDC vs Fixed', () => {
  const editSizes = [1, 10, 100, 1000];
  const baseFile = buf1MB;

  // Pre-compute chunks and digests for both strategies
  let cdcBaseDigests;
  let fixedBaseDigests;
  let dedupTablePrinted = false;

  /**
   * Chunk a buffer and return a Set of SHA-256 digests.
   */
  async function chunkDigests(chunker, buf) {
    const chunks = await collectChunks(chunker.chunk(bufferToAsyncIterable(buf)));
    return new Set(chunks.map(sha256));
  }

  /**
   * Compute reuse percentage: how many chunks from `modified` already
   * exist in `baseDigests`.
   */
  function reusePercent(baseDigests, modifiedDigests) {
    let reused = 0;
    for (const d of modifiedDigests) {
      if (baseDigests.has(d)) { reused++; }
    }
    return modifiedDigests.size === 0 ? 0 : (reused / modifiedDigests.size) * 100;
  }

  // Run the dedup comparison once and print a table.
  // We use a bench that does the real work on first invocation, then is a no-op.
  bench('compute & report', async () => {
    if (dedupTablePrinted) { return; }

    const cdcChunker = new CdcChunker(CDC_OPTS);
    const fixedChunker = new FixedChunker(FIXED_OPTS);

    // Base file digests
    cdcBaseDigests = await chunkDigests(cdcChunker, baseFile);
    fixedBaseDigests = await chunkDigests(fixedChunker, baseFile);

    const rows = [];

    for (const editSize of editSizes) {
      const modified = createModifiedBuffer(baseFile, editSize);

      const cdcModDigests = await chunkDigests(cdcChunker, modified);
      const fixedModDigests = await chunkDigests(fixedChunker, modified);

      const cdcReuse = reusePercent(cdcBaseDigests, cdcModDigests);
      const fixedReuse = reusePercent(fixedBaseDigests, fixedModDigests);

      rows.push({
        'Edit size': `${String(editSize).padStart(5)}B`,
        'Fixed chunks': fixedModDigests.size,
        'Fixed reuse': `${fixedReuse.toFixed(1)}%`,
        'CDC chunks': cdcModDigests.size,
        'CDC reuse': `${cdcReuse.toFixed(1)}%`,
      });
    }

    console.log('\n');
    console.log('='.repeat(70));
    console.log('  Dedup Efficiency: CDC vs Fixed (1 MB base file, 16 KiB target)');
    console.log('='.repeat(70));
    console.log(
      '  Edit size | Fixed chunks | Fixed reuse |  CDC chunks |  CDC reuse',
    );
    console.log(
      '  ----------|--------------|-------------|-------------|------------',
    );
    for (const r of rows) {
      console.log(
        `  ${r['Edit size'].padStart(9)} |` +
        `  ${String(r['Fixed chunks']).padStart(11)} |` +
        `  ${r['Fixed reuse'].padStart(10)} |` +
        `  ${String(r['CDC chunks']).padStart(10)} |` +
        `  ${r['CDC reuse'].padStart(9)}`,
      );
    }
    console.log('='.repeat(70));
    console.log('');

    dedupTablePrinted = true;
  }, { iterations: 1, time: 0 });
});
