import { describe, expect, it } from 'vitest';
import {
  concatBytes,
  copyBytes,
  normalizeByteChunk,
  readUint32BE,
  writeUint32BE,
} from '../../../../src/domain/bytes/ByteLayout.js';

describe('ByteLayout', () => {
  it('concatenates Uint8Array chunks without Buffer', () => {
    const result = concatBytes([
      new Uint8Array([1, 2]),
      new Uint8Array([3]),
      new Uint8Array([4, 5]),
    ]);

    expect([...result]).toEqual([1, 2, 3, 4, 5]);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('copies ranges between Uint8Array instances', () => {
    const target = new Uint8Array(5);
    copyBytes({
      source: new Uint8Array([10, 11, 12, 13]),
      target,
      targetOffset: 1,
      sourceStart: 1,
      sourceEnd: 3,
    });
    expect([...target]).toEqual([0, 11, 12, 0, 0]);
  });

  it('reads and writes uint32 big-endian values', () => {
    const bytes = new Uint8Array(4);
    writeUint32BE(bytes, 0, 0xdecafbad);
    expect([...bytes]).toEqual([0xde, 0xca, 0xfb, 0xad]);
    expect(readUint32BE(bytes)).toBe(0xdecafbad);
  });

  it('normalizes Uint8Array chunks and rejects strings', () => {
    const chunk = new Uint8Array([1]);
    expect(normalizeByteChunk(chunk)).toBe(chunk);
    expect(() => normalizeByteChunk('abc')).toThrow(/Uint8Array/);
  });
});
