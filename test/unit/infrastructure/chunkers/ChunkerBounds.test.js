import { describe, it, expect } from 'vitest';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import CdcChunker from '../../../../src/infrastructure/chunkers/CdcChunker.js';

const MiB = 1024 * 1024;

describe('FixedChunker — chunk size upper bound', () => {
  it('throws when chunkSize > 100 MiB', () => {
    expect(() => new FixedChunker({ chunkSize: 100 * MiB + 1 })).toThrow(RangeError);
  });

  it('accepts exactly 100 MiB', () => {
    const chunker = new FixedChunker({ chunkSize: 100 * MiB });
    expect(chunker.params.chunkSize).toBe(100 * MiB);
  });
});

describe('FixedChunker — chunk size lower bound', () => {
  it('throws when chunkSize is 0', () => {
    expect(() => new FixedChunker({ chunkSize: 0 })).toThrow(RangeError);
  });

  it('throws when chunkSize is negative', () => {
    expect(() => new FixedChunker({ chunkSize: -1 })).toThrow(RangeError);
  });

  it('throws when chunkSize is NaN', () => {
    expect(() => new FixedChunker({ chunkSize: NaN })).toThrow(RangeError);
  });

  it('throws when chunkSize is not an integer', () => {
    expect(() => new FixedChunker({ chunkSize: 1.5 })).toThrow(RangeError);
  });

  it('accepts chunkSize of 1', () => {
    const chunker = new FixedChunker({ chunkSize: 1 });
    expect(chunker.params.chunkSize).toBe(1);
  });
});

describe('CdcChunker — chunk size upper bound', () => {
  it('throws when maxChunkSize > 100 MiB', () => {
    expect(() => new CdcChunker({
      maxChunkSize: 100 * MiB + 1,
      minChunkSize: 1024,
      targetChunkSize: 50 * MiB,
    })).toThrow(RangeError);
  });

  it('accepts exactly 100 MiB as maxChunkSize', () => {
    const chunker = new CdcChunker({
      maxChunkSize: 100 * MiB,
      minChunkSize: 1024,
      targetChunkSize: 50 * MiB,
    });
    expect(chunker.params.max).toBe(100 * MiB);
  });
});
