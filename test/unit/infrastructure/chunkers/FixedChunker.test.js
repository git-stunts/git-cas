import { describe, it, expect } from 'vitest';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';

async function* toAsyncIter(buffers) {
  for (const b of buffers) { yield b; }
}

async function collect(iter) {
  const result = [];
  for await (const chunk of iter) { result.push(chunk); }
  return result;
}

describe('16.4: FixedChunker pre-allocated buffer — regression', () => {
  it('produces byte-exact output for a single large input', async () => {
    const chunkSize = 64;
    const chunker = new FixedChunker({ chunkSize });
    const input = Buffer.alloc(200);
    for (let i = 0; i < input.length; i++) { input[i] = i & 0xff; }

    const chunks = await collect(chunker.chunk(toAsyncIter([input])));
    expect(chunks.map((c) => c.length)).toEqual([64, 64, 64, 8]);
    expect(Buffer.concat(chunks).equals(input)).toBe(true);
  });

  it('exact multiple of chunkSize produces no partial', async () => {
    const chunkSize = 128;
    const chunker = new FixedChunker({ chunkSize });
    const input = Buffer.alloc(chunkSize * 3, 0xbb);
    const chunks = await collect(chunker.chunk(toAsyncIter([input])));
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length === chunkSize)).toBe(true);
  });
});

describe('16.4: FixedChunker pre-allocated buffer — edge cases', () => {
  it('many small input buffers reassemble correctly', async () => {
    const chunkSize = 256;
    const chunker = new FixedChunker({ chunkSize });
    const total = 1024;
    const smallBufs = Array.from({ length: total }, (_, i) => Buffer.from([i & 0xff]));

    const chunks = await collect(chunker.chunk(toAsyncIter(smallBufs)));
    expect(chunks.length).toBe(4);
    const reassembled = Buffer.concat(chunks);
    for (let i = 0; i < total; i++) {
      expect(reassembled[i]).toBe(i & 0xff);
    }
  });

  it('empty source produces no chunks', async () => {
    const chunker = new FixedChunker({ chunkSize: 64 });
    const chunks = await collect(chunker.chunk(toAsyncIter([])));
    expect(chunks.length).toBe(0);
  });

  it('single byte produces one partial chunk', async () => {
    const chunker = new FixedChunker({ chunkSize: 64 });
    const chunks = await collect(chunker.chunk(toAsyncIter([Buffer.from([42])])));
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toEqual(Buffer.from([42]));
  });
});
