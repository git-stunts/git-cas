import { describe, it, expect } from 'vitest';
import CompressionPort from '../../../src/ports/CompressionPort.js';

describe('CompressionPort – abstract guard', () => {
  it('cannot be instantiated directly', () => {
    expect(() => new CompressionPort()).toThrow(
      'CompressionPort is abstract and cannot be instantiated directly',
    );
  });
});

describe('CompressionPort – base class methods throw Not implemented', () => {
  class Stub extends CompressionPort {}
  const stub = new Stub();

  it('compressBuffer', async () => {
    await expect(stub.compressBuffer(Buffer.alloc(0))).rejects.toThrow('Not implemented');
  });

  it('decompressBuffer', async () => {
    await expect(stub.decompressBuffer(Buffer.alloc(0))).rejects.toThrow('Not implemented');
  });

  it('compressStream', async () => {
    await expect(async () => {
      for await (const _chunk of stub.compressStream([])) { void _chunk; }
    }).rejects.toThrow('Not implemented');
  });

  it('decompressStream', async () => {
    await expect(async () => {
      for await (const _chunk of stub.decompressStream([])) { void _chunk; }
    }).rejects.toThrow('Not implemented');
  });
});

describe('CompressionPort – subclass conformance', () => {
  it('subclass that implements all methods is an instance of CompressionPort', () => {
    class TestCompression extends CompressionPort {
      async compressBuffer(buffer) { return buffer; }
      async decompressBuffer(buffer) { return buffer; }
      async *compressStream(source) { for await (const buf of source) { yield buf; } }
      async *decompressStream(source) { for await (const buf of source) { yield buf; } }
    }

    const adapter = new TestCompression();
    expect(adapter).toBeInstanceOf(CompressionPort);
  });
});
