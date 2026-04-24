import { describe, it, expect } from 'vitest';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';
import CompressionPort from '../../../../src/ports/CompressionPort.js';

async function collect(source) {
  const chunks = [];
  for await (const chunk of source) { chunks.push(chunk); }
  return Buffer.concat(chunks);
}

async function* toAsyncIterable(buffer) { yield buffer; }

describe('NodeCompressionAdapter – identity', () => {
  it('is an instance of CompressionPort', () => {
    expect(new NodeCompressionAdapter()).toBeInstanceOf(CompressionPort);
  });
});

describe('NodeCompressionAdapter – buffer round-trip', () => {
  const adapter = new NodeCompressionAdapter();

  it('compresses and decompresses a buffer', async () => {
    const input = Buffer.from('hello world — this is a compression round-trip test');
    const compressed = await adapter.compressBuffer(input);
    expect(compressed).not.toEqual(input);
    const decompressed = await adapter.decompressBuffer(compressed);
    expect(decompressed).toEqual(input);
  });

  it('handles empty buffer', async () => {
    const input = Buffer.alloc(0);
    const compressed = await adapter.compressBuffer(input);
    const decompressed = await adapter.decompressBuffer(compressed);
    expect(decompressed).toEqual(input);
  });

  it('handles large buffer', async () => {
    const input = Buffer.alloc(256 * 1024, 0xab);
    const compressed = await adapter.compressBuffer(input);
    const decompressed = await adapter.decompressBuffer(compressed);
    expect(decompressed).toEqual(input);
  });
});

describe('NodeCompressionAdapter – stream round-trip', () => {
  const adapter = new NodeCompressionAdapter();

  it('compresses and decompresses a stream', async () => {
    const input = Buffer.from('streaming compression round-trip test with more data');
    const compressed = await collect(adapter.compressStream(toAsyncIterable(input)));
    expect(compressed).not.toEqual(input);
    const decompressed = await collect(adapter.decompressStream(toAsyncIterable(compressed)));
    expect(decompressed).toEqual(input);
  });

  it('handles empty stream', async () => {
    const input = Buffer.alloc(0);
    const compressed = await collect(adapter.compressStream(toAsyncIterable(input)));
    const decompressed = await collect(adapter.decompressStream(toAsyncIterable(compressed)));
    expect(decompressed).toEqual(input);
  });

  it('handles multi-chunk input', async () => {
    const chunks = [Buffer.from('chunk one '), Buffer.from('chunk two '), Buffer.from('chunk three')];
    async function* multiChunk() { for (const c of chunks) { yield c; } }
    const compressed = await collect(adapter.compressStream(multiChunk()));
    const decompressed = await collect(adapter.decompressStream(toAsyncIterable(compressed)));
    expect(decompressed).toEqual(Buffer.concat(chunks));
  });
});

describe('NodeCompressionAdapter – cross-mode round-trip', () => {
  const adapter = new NodeCompressionAdapter();

  it('buffer-compress then stream-decompress', async () => {
    const input = Buffer.from('cross-mode test: buffer to stream');
    const compressed = await adapter.compressBuffer(input);
    const decompressed = await collect(adapter.decompressStream(toAsyncIterable(compressed)));
    expect(decompressed).toEqual(input);
  });

  it('stream-compress then buffer-decompress', async () => {
    const input = Buffer.from('cross-mode test: stream to buffer');
    const compressed = await collect(adapter.compressStream(toAsyncIterable(input)));
    const decompressed = await adapter.decompressBuffer(compressed);
    expect(decompressed).toEqual(input);
  });
});
