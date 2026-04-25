import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import CdcChunker from '../../../../src/infrastructure/chunkers/CdcChunker.js';

/** Helper: async iterable from a single Buffer. */
async function* toAsyncIter(buf) {
  yield buf;
}

/** Collect all chunks from a chunker. */
async function collectChunks(chunker, source) {
  const chunks = [];
  for await (const chunk of chunker.chunk(source)) {
    chunks.push(chunk);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Normalized flag in params
// ---------------------------------------------------------------------------
describe('CdcChunker – normalized params', () => {
  it('defaults normalized to true', () => {
    const chunker = new CdcChunker();
    expect(chunker.params.normalized).toBe(true);
  });

  it('reports normalized: false when disabled', () => {
    const chunker = new CdcChunker({ normalized: false });
    expect(chunker.params.normalized).toBe(false);
  });

  it('reports normalized: true when enabled explicitly', () => {
    const chunker = new CdcChunker({ normalized: true });
    expect(chunker.params.normalized).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dual-mask produces tighter distribution than single-mask
// ---------------------------------------------------------------------------
describe('CdcChunker – normalized distribution', () => {
  // Use small chunk sizes for fast tests
  const opts = {
    minChunkSize: 512,
    maxChunkSize: 8192,
    targetChunkSize: 2048,
  };

  // Generate random test data
  const data = randomBytes(256 * 1024); // 256 KiB

  it('normalized chunks have smaller size variance than non-normalized', async () => {
    const normalizedChunker = new CdcChunker({ ...opts, normalized: true });
    const classicChunker = new CdcChunker({ ...opts, normalized: false });

    const normalizedChunks = await collectChunks(normalizedChunker, toAsyncIter(data));
    const classicChunks = await collectChunks(classicChunker, toAsyncIter(data));

    // Both must produce chunks
    expect(normalizedChunks.length).toBeGreaterThan(1);
    expect(classicChunks.length).toBeGreaterThan(1);

    // Calculate variance (exclude last chunk — it's a runt)
    function variance(chunks) {
      const sizes = chunks.slice(0, -1).map((c) => c.length);
      const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      return sizes.reduce((sum, s) => sum + (s - mean) ** 2, 0) / sizes.length;
    }

    const normalizedVar = variance(normalizedChunks);
    const classicVar = variance(classicChunks);

    // Normalized should have tighter distribution (lower variance)
    expect(normalizedVar).toBeLessThan(classicVar);
  });

  it('both modes reconstruct identical data', async () => {
    const normalizedChunker = new CdcChunker({ ...opts, normalized: true });
    const classicChunker = new CdcChunker({ ...opts, normalized: false });

    const normalizedChunks = await collectChunks(normalizedChunker, toAsyncIter(data));
    const classicChunks = await collectChunks(classicChunker, toAsyncIter(data));

    const normalizedReassembled = Buffer.concat(normalizedChunks);
    const classicReassembled = Buffer.concat(classicChunks);

    expect(normalizedReassembled).toEqual(data);
    expect(classicReassembled).toEqual(data);
  });
});
