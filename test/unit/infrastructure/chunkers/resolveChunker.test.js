import { describe, it, expect } from 'vitest';
import resolveChunker from '../../../../src/infrastructure/chunkers/resolveChunker.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import CdcChunker from '../../../../src/infrastructure/chunkers/CdcChunker.js';
import ChunkingPort from '../../../../src/ports/ChunkingPort.js';

describe('resolveChunker – defaults', () => {
  it('returns undefined when called with no arguments', () => {
    expect(resolveChunker()).toBeUndefined();
  });

  it('returns undefined when called with empty object', () => {
    expect(resolveChunker({})).toBeUndefined();
  });
});

describe('resolveChunker – raw chunker', () => {
  it('returns the chunker instance when chunker is provided', () => {
    const custom = new CdcChunker();
    expect(resolveChunker({ chunker: custom })).toBe(custom);
  });

  it('chunker takes precedence over chunking config', () => {
    const custom = new CdcChunker();
    const result = resolveChunker({
      chunker: custom,
      chunking: { strategy: 'fixed', chunkSize: 1024 },
    });
    expect(result).toBe(custom);
  });
});

describe('resolveChunker – cdc strategy', () => {
  it('chunking: { strategy: "cdc" } returns CdcChunker', () => {
    const result = resolveChunker({
      chunking: { strategy: 'cdc', targetChunkSize: 262144, minChunkSize: 65536, maxChunkSize: 1048576 },
    });
    expect(result).toBeInstanceOf(CdcChunker);
    expect(result).toBeInstanceOf(ChunkingPort);
    expect(result.params).toEqual({ target: 262144, min: 65536, max: 1048576, normalized: true });
  });

  it('chunking: { strategy: "cdc" } with defaults works', () => {
    const result = resolveChunker({ chunking: { strategy: 'cdc' } });
    expect(result).toBeInstanceOf(CdcChunker);
  });
});

describe('resolveChunker – fixed strategy', () => {
  it('chunking: { strategy: "fixed", chunkSize } returns FixedChunker', () => {
    const result = resolveChunker({ chunking: { strategy: 'fixed', chunkSize: 131072 } });
    expect(result).toBeInstanceOf(FixedChunker);
    expect(result.params).toEqual({ chunkSize: 131072 });
  });

  it('chunking: { strategy: "fixed" } without chunkSize returns undefined', () => {
    expect(resolveChunker({ chunking: { strategy: 'fixed' } })).toBeUndefined();
  });

  it('chunking: { strategy: "fixed", chunkSize: NaN } returns undefined', () => {
    expect(resolveChunker({ chunking: { strategy: 'fixed', chunkSize: NaN } })).toBeUndefined();
  });

  it('chunking: { strategy: "fixed", chunkSize: -1 } returns undefined', () => {
    expect(resolveChunker({ chunking: { strategy: 'fixed', chunkSize: -1 } })).toBeUndefined();
  });

  it('chunking: { strategy: "fixed", chunkSize: Infinity } returns undefined', () => {
    expect(resolveChunker({ chunking: { strategy: 'fixed', chunkSize: Infinity } })).toBeUndefined();
  });

  it('chunking: { strategy: "unknown" } returns undefined', () => {
    expect(resolveChunker({ chunking: { strategy: 'unknown' } })).toBeUndefined();
  });
});
