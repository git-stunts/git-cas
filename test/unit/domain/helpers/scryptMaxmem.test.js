import { describe, expect, it } from 'vitest';
import scryptMaxmem from '../../../../src/domain/helpers/scryptMaxmem.js';

describe('scryptMaxmem', () => {
  it('computes the shared scrypt maxmem budget from the runtime parameters', () => {
    expect(scryptMaxmem({
      cost: 16384,
      blockSize: 8,
      parallelization: 1,
      keyLength: 32,
    })).toBe((128 * 16384 * 8) + (256 * 8 * 1) + 32 + (1024 * 1024));
  });
});
