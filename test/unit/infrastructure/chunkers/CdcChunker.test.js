import { describe, it, expect } from 'vitest';
import CdcChunker from '../../../../src/infrastructure/chunkers/CdcChunker.js';
import ChunkingPort from '../../../../src/ports/ChunkingPort.js';

// ---------------------------------------------------------------------------
// ChunkingPort compliance
// ---------------------------------------------------------------------------

describe('CdcChunker – ChunkingPort compliance', () => {
  it('is an instance of ChunkingPort', () => {
    const chunker = new CdcChunker();
    expect(chunker).toBeInstanceOf(ChunkingPort);
  });

  it('strategy returns "cdc"', () => {
    const chunker = new CdcChunker();
    expect(chunker.strategy).toBe('cdc');
  });

  it('params returns correct default config', () => {
    const chunker = new CdcChunker();
    expect(chunker.params).toEqual({
      target: 262144,
      min: 65536,
      max: 1048576,
    });
  });

  it('params returns correct custom config', () => {
    const chunker = new CdcChunker({
      targetChunkSize: 128000,
      minChunkSize: 32000,
      maxChunkSize: 512000,
    });
    expect(chunker.params).toEqual({
      target: 128000,
      min: 32000,
      max: 512000,
    });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect all chunks from the chunker into an array.
 * @param {AsyncIterable<Buffer>} iterable
 * @returns {Promise<Buffer[]>}
 */
async function collect(iterable) {
  const chunks = [];
  for await (const c of iterable) { chunks.push(c); }
  return chunks;
}

/**
 * Wrap a single Buffer as a one-element async iterable.
 * @param {Buffer} buf
 * @returns {AsyncIterable<Buffer>}
 */
async function* asStream(buf) {
  yield buf;
}

/**
 * Yield a Buffer in fixed-size pieces (simulates chunked I/O).
 * @param {Buffer} buf
 * @param {number} pieceSize
 * @returns {AsyncIterable<Buffer>}
 */
async function* inPieces(buf, pieceSize) {
  for (let i = 0; i < buf.length; i += pieceSize) {
    yield buf.subarray(i, Math.min(i + pieceSize, buf.length));
  }
}

/**
 * Deterministic pseudo-random buffer using a simple xorshift32 seeded PRNG.
 * @param {number} size
 * @param {number} [seed=42]
 * @returns {Buffer}
 */
function seededRandomBuffer(size, seed = 42) {
  const buf = Buffer.allocUnsafe(size);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < size; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    buf[i] = (s >>> 0) & 0xff;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe('CdcChunker – config validation', () => {
  it('throws when minChunkSize > maxChunkSize', () => {
    expect(() => new CdcChunker({ minChunkSize: 200, maxChunkSize: 100, targetChunkSize: 150 }))
      .toThrow(RangeError);
  });

  it('throws when targetChunkSize < minChunkSize', () => {
    expect(() => new CdcChunker({ minChunkSize: 100, maxChunkSize: 1000, targetChunkSize: 50 }))
      .toThrow(RangeError);
  });

  it('throws when targetChunkSize > maxChunkSize', () => {
    expect(() => new CdcChunker({ minChunkSize: 100, maxChunkSize: 1000, targetChunkSize: 2000 }))
      .toThrow(RangeError);
  });

  it('accepts valid config at boundary values', () => {
    expect(() => new CdcChunker({ minChunkSize: 256, maxChunkSize: 256, targetChunkSize: 256 }))
      .not.toThrow();
  });

  it('uses defaults when no options are provided', () => {
    expect(() => new CdcChunker()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('CdcChunker – edge cases', () => {
  it('yields nothing for empty input', async () => {
    const chunker = new CdcChunker({ minChunkSize: 64, maxChunkSize: 256, targetChunkSize: 128 });
    async function* empty() { /* yields nothing */ }
    const chunks = await collect(chunker.chunk(empty()));
    expect(chunks).toHaveLength(0);
  });

  it('yields a single chunk for a 1-byte input', async () => {
    const chunker = new CdcChunker({ minChunkSize: 64, maxChunkSize: 256, targetChunkSize: 128 });
    const chunks = await collect(chunker.chunk(asStream(Buffer.from([0x42]))));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(Buffer.from([0x42]));
  });

  it('yields a single chunk when input < minChunkSize', async () => {
    const chunker = new CdcChunker({ minChunkSize: 1024, maxChunkSize: 4096, targetChunkSize: 2048 });
    const buf = seededRandomBuffer(512);
    const chunks = await collect(chunker.chunk(asStream(buf)));
    expect(chunks).toHaveLength(1);
    expect(Buffer.concat(chunks)).toEqual(buf);
  });

  it('yields at most 2 chunks for input exactly maxChunkSize', async () => {
    const chunker = new CdcChunker({ minChunkSize: 1024, maxChunkSize: 4096, targetChunkSize: 2048 });
    const buf = seededRandomBuffer(4096);
    const chunks = await collect(chunker.chunk(asStream(buf)));
    // Might be 1 chunk (if boundary found right at end or forced at max)
    // or 2 if a natural boundary fell inside.
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.length).toBeLessThanOrEqual(2);
    expect(Buffer.concat(chunks)).toEqual(buf);
  });

  it('handles all-zero input (degenerate hash) with forced max boundaries', async () => {
    const chunker = new CdcChunker({ minChunkSize: 1024, maxChunkSize: 4096, targetChunkSize: 2048 });
    const buf = Buffer.alloc(16384); // 16 KiB of zeros
    const chunks = await collect(chunker.chunk(asStream(buf)));

    // Every chunk must respect the size bounds.
    const totalBytes = chunks.reduce((sum, c) => sum + c.length, 0);
    expect(totalBytes).toBe(16384);
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i].length).toBeGreaterThanOrEqual(1024);
      expect(chunks[i].length).toBeLessThanOrEqual(4096);
    }
    expect(chunks[chunks.length - 1].length).toBeLessThanOrEqual(4096);
  });
});

// ---------------------------------------------------------------------------
// Golden path
// ---------------------------------------------------------------------------

describe('CdcChunker – golden path', () => {
  it('splits a 1 MiB buffer into roughly 4 chunks (target 256 KiB)', async () => {
    const chunker = new CdcChunker();
    const buf = seededRandomBuffer(1_048_576); // 1 MiB
    const chunks = await collect(chunker.chunk(asStream(buf)));

    // With target 256 KiB we expect ~4 chunks, allow some variance.
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.length).toBeLessThanOrEqual(16);

    // Total bytes must match input
    const totalBytes = chunks.reduce((sum, c) => sum + c.length, 0);
    expect(totalBytes).toBe(1_048_576);
  });

  it('produces identical chunks for the same buffer (deterministic)', async () => {
    const chunker = new CdcChunker();
    const buf = seededRandomBuffer(1_048_576);

    const run1 = await collect(chunker.chunk(asStream(buf)));
    const run2 = await collect(chunker.chunk(asStream(buf)));

    expect(run1.length).toBe(run2.length);
    for (let i = 0; i < run1.length; i++) {
      expect(run1[i]).toEqual(run2[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// Dedup (shift-resistance)
// ---------------------------------------------------------------------------

describe('CdcChunker – dedup / shift-resistance', () => {
  it('only 1-2 chunks differ when 10 bytes are modified at offset 500 KiB', async () => {
    const chunker = new CdcChunker();
    const original = seededRandomBuffer(1_048_576);
    const modified = Buffer.from(original);

    // Modify 10 bytes at offset 512000 (~500 KiB)
    for (let i = 0; i < 10; i++) {
      modified[512_000 + i] ^= 0xff;
    }

    const originalChunks = await collect(chunker.chunk(asStream(original)));
    const modifiedChunks = await collect(chunker.chunk(asStream(modified)));

    // Count how many chunks differ.  We compare by content.
    const origSet = new Set(originalChunks.map((c) => c.toString('hex')));
    const modSet = new Set(modifiedChunks.map((c) => c.toString('hex')));

    let diffCount = 0;
    for (const h of modSet) {
      if (!origSet.has(h)) { diffCount++; }
    }

    // Expect at most 3 chunks to differ (usually 1–2).
    expect(diffCount).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('CdcChunker – determinism', () => {
  it('produces identical output 100 times in a row', async () => {
    const chunker = new CdcChunker({
      minChunkSize: 256,
      maxChunkSize: 4096,
      targetChunkSize: 1024,
    });
    const buf = seededRandomBuffer(32_768);

    const reference = await collect(chunker.chunk(asStream(buf)));
    const refLengths = reference.map((c) => c.length);
    const refHashes = reference.map((c) => c.toString('hex'));

    for (let run = 0; run < 100; run++) {
      const chunks = await collect(chunker.chunk(asStream(buf)));
      expect(chunks.map((c) => c.length)).toEqual(refLengths);
      expect(chunks.map((c) => c.toString('hex'))).toEqual(refHashes);
    }
  });
});

// ---------------------------------------------------------------------------
// Size bounds
// ---------------------------------------------------------------------------

describe('CdcChunker – size bounds', () => {
  it('all non-final chunks respect min/max for 100 random buffers', async () => {
    const minChunkSize = 512;
    const maxChunkSize = 8192;
    const targetChunkSize = 2048;
    const chunker = new CdcChunker({ minChunkSize, maxChunkSize, targetChunkSize });

    for (let i = 0; i < 100; i++) {
      // Buffer size between 1 KiB and 64 KiB (seeded so reproducible)
      const size = 1024 + ((i * 631) % (64 * 1024));
      const buf = seededRandomBuffer(size, 1000 + i);
      const chunks = await collect(chunker.chunk(asStream(buf)));

      expect(chunks.length).toBeGreaterThanOrEqual(1);

      // Total bytes must match
      const totalBytes = chunks.reduce((sum, c) => sum + c.length, 0);
      expect(totalBytes).toBe(size);

      // All chunks except the last must satisfy bounds
      for (let j = 0; j < chunks.length - 1; j++) {
        expect(chunks[j].length).toBeGreaterThanOrEqual(minChunkSize);
        expect(chunks[j].length).toBeLessThanOrEqual(maxChunkSize);
      }

      // Last chunk can be smaller than min, but must not exceed max
      expect(chunks[chunks.length - 1].length).toBeLessThanOrEqual(maxChunkSize);
    }
  });
});

// ---------------------------------------------------------------------------
// Streaming (small-buffer I/O)
// ---------------------------------------------------------------------------

describe('CdcChunker – streaming', () => {
  it('produces the same chunks regardless of input buffer sizes', async () => {
    const chunker = new CdcChunker({
      minChunkSize: 256,
      maxChunkSize: 4096,
      targetChunkSize: 1024,
    });
    const buf = seededRandomBuffer(32_768);

    // Single large buffer
    const whole = await collect(chunker.chunk(asStream(buf)));

    // Small pieces (simulate chunked I/O with 137-byte reads)
    const streamed = await collect(chunker.chunk(inPieces(buf, 137)));

    expect(streamed.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) {
      expect(streamed[i]).toEqual(whole[i]);
    }
  });

  it('handles async iterable that yields many tiny buffers', async () => {
    const chunker = new CdcChunker({
      minChunkSize: 256,
      maxChunkSize: 4096,
      targetChunkSize: 1024,
    });
    const buf = seededRandomBuffer(8192);

    // 1-byte reads
    const chunks = await collect(chunker.chunk(inPieces(buf, 1)));
    const totalBytes = chunks.reduce((sum, c) => sum + c.length, 0);
    expect(totalBytes).toBe(8192);

    // Must produce same output as whole-buffer approach
    const reference = await collect(chunker.chunk(asStream(buf)));
    expect(chunks.length).toBe(reference.length);
    for (let i = 0; i < reference.length; i++) {
      expect(chunks[i]).toEqual(reference[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// Data integrity
// ---------------------------------------------------------------------------

describe('CdcChunker – data integrity', () => {
  it('concatenated chunks always equal the original input', async () => {
    const chunker = new CdcChunker({
      minChunkSize: 512,
      maxChunkSize: 8192,
      targetChunkSize: 2048,
    });

    for (const size of [0, 1, 100, 512, 2048, 8192, 50_000]) {
      const buf = seededRandomBuffer(size);
      const chunks = await collect(chunker.chunk(asStream(buf)));
      const reassembled = Buffer.concat(chunks);
      expect(reassembled).toEqual(buf);
    }
  });
});
