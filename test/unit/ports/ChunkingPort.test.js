import { describe, it, expect } from 'vitest';
import ChunkingPort from '../../../src/ports/ChunkingPort.js';

describe('ChunkingPort (abstract)', () => {
  it('cannot be instantiated directly', () => {
    expect(() => new ChunkingPort()).toThrow(
      'ChunkingPort is abstract and cannot be instantiated directly',
    );
  });

  it('strategy throws Not implemented on base class', () => {
    class Stub extends ChunkingPort {}
    const stub = new Stub();
    expect(() => stub.strategy).toThrow('Not implemented');
  });

  it('params throws Not implemented on base class', () => {
    class Stub extends ChunkingPort {}
    const stub = new Stub();
    expect(() => stub.params).toThrow('Not implemented');
  });

  it('chunk() throws Not implemented on base class', async () => {
    class Stub extends ChunkingPort {}
    const stub = new Stub();
    await expect(async () => {
      // eslint-disable-next-line no-unused-vars
      for await (const _chunk of stub.chunk([])) { /* drain */ }
    }).rejects.toThrow('Not implemented');
  });

  it('subclass that implements all methods works fine', () => {
    class TestChunker extends ChunkingPort {
      get strategy() { return 'test'; }
      get params() { return { foo: 1 }; }
      async *chunk(source) {
        for await (const buf of source) { yield buf; }
      }
    }

    const chunker = new TestChunker();
    expect(chunker.strategy).toBe('test');
    expect(chunker.params).toEqual({ foo: 1 });
    expect(chunker).toBeInstanceOf(ChunkingPort);
  });
});
