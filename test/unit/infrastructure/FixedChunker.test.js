import { describe, it, expect } from 'vitest';
import FixedChunker from '../../../src/infrastructure/chunkers/FixedChunker.js';
import ChunkingPort from '../../../src/ports/ChunkingPort.js';

/**
 * Helper: collect all chunks from an async generator into an array.
 * @param {AsyncIterable<Buffer>} gen
 * @returns {Promise<Buffer[]>}
 */
async function collect(gen) {
  const chunks = [];
  for await (const buf of gen) { chunks.push(buf); }
  return chunks;
}

/**
 * Helper: create an async iterable from an array of Buffers.
 * @param {Buffer[]} buffers
 * @returns {AsyncIterable<Buffer>}
 */
async function* toAsync(buffers) {
  for (const buf of buffers) { yield buf; }
}

describe('FixedChunker', () => { // eslint-disable-line max-lines-per-function
  const KiB = 1024;

  it('is an instance of ChunkingPort', () => {
    const chunker = new FixedChunker();
    expect(chunker).toBeInstanceOf(ChunkingPort);
  });

  it('strategy returns "fixed"', () => {
    const chunker = new FixedChunker();
    expect(chunker.strategy).toBe('fixed');
  });

  it('params returns { chunkSize } with configured value', () => {
    const chunker = new FixedChunker({ chunkSize: 1024 });
    expect(chunker.params).toEqual({ chunkSize: 1024 });
  });

  it('default chunkSize is 262144 (256 KiB)', () => {
    const chunker = new FixedChunker();
    expect(chunker.params).toEqual({ chunkSize: 262144 });
  });

  it('golden path: 1 MB buffer → exactly 4 × 256 KiB chunks', async () => {
    const chunkSize = 256 * KiB;
    const chunker = new FixedChunker({ chunkSize });
    const source = toAsync([Buffer.alloc(1024 * KiB, 0xab)]);

    const chunks = await collect(chunker.chunk(source));

    expect(chunks).toHaveLength(4);
    for (const chunk of chunks) {
      expect(chunk.length).toBe(chunkSize);
    }
  });

  it('remainder: 700 KiB → 2 × 256 KiB + 1 × 188 KiB', async () => {
    const chunkSize = 256 * KiB;
    const chunker = new FixedChunker({ chunkSize });
    const source = toAsync([Buffer.alloc(700 * KiB, 0xcd)]);

    const chunks = await collect(chunker.chunk(source));

    expect(chunks).toHaveLength(3);
    expect(chunks[0].length).toBe(256 * KiB);
    expect(chunks[1].length).toBe(256 * KiB);
    expect(chunks[2].length).toBe(188 * KiB);
  });

  it('single chunk: buffer smaller than chunkSize → 1 chunk', async () => {
    const chunkSize = 256 * KiB;
    const chunker = new FixedChunker({ chunkSize });
    const source = toAsync([Buffer.alloc(100 * KiB, 0xef)]);

    const chunks = await collect(chunker.chunk(source));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].length).toBe(100 * KiB);
  });

  it('empty: empty async iterable → no chunks', async () => {
    const chunker = new FixedChunker();
    const source = toAsync([]);

    const chunks = await collect(chunker.chunk(source));

    expect(chunks).toHaveLength(0);
  });

  it('exact multiple: 512 KiB with 256 KiB chunkSize → exactly 2 chunks', async () => {
    const chunkSize = 256 * KiB;
    const chunker = new FixedChunker({ chunkSize });
    const source = toAsync([Buffer.alloc(512 * KiB, 0x99)]);

    const chunks = await collect(chunker.chunk(source));

    expect(chunks).toHaveLength(2);
    expect(chunks[0].length).toBe(chunkSize);
    expect(chunks[1].length).toBe(chunkSize);
  });

  it('streaming: many small buffers still produce correct chunkSize outputs', async () => {
    const chunkSize = 256 * KiB;
    const chunker = new FixedChunker({ chunkSize });

    // 700 × 1 KiB buffers = 700 KiB total → 2 × 256 KiB + 1 × 188 KiB
    const smallBuffers = Array.from({ length: 700 }, () => Buffer.alloc(1 * KiB, 0x42));
    const source = toAsync(smallBuffers);

    const chunks = await collect(chunker.chunk(source));

    expect(chunks).toHaveLength(3);
    expect(chunks[0].length).toBe(256 * KiB);
    expect(chunks[1].length).toBe(256 * KiB);
    expect(chunks[2].length).toBe(188 * KiB);

    // Verify total size is preserved
    const totalSize = chunks.reduce((sum, c) => sum + c.length, 0);
    expect(totalSize).toBe(700 * KiB);
  });

  it('preserves byte content through chunking', async () => {
    const chunkSize = 4;
    const chunker = new FixedChunker({ chunkSize });
    const input = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const source = toAsync([input]);

    const chunks = await collect(chunker.chunk(source));

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(chunks[1]).toEqual(Buffer.from([5, 6, 7, 8]));
    expect(chunks[2]).toEqual(Buffer.from([9, 10]));
  });
});
