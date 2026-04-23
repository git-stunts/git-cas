import { describe, it, expect } from 'vitest';
import { assertKdfPolicy } from '../../../src/helpers/kdfPolicy.js';

const SOURCE = 'test';

const scryptParams = (cost, blockSize) => ({
  algorithm: 'scrypt',
  cost,
  blockSize,
  parallelization: 1,
  keyLength: 32,
});

// ---------------------------------------------------------------------------
// scrypt combined memory budget — accepted combinations
// ---------------------------------------------------------------------------
describe('kdfPolicy – scrypt memory cap (accepted)', () => {
  it('accepts default parameters (N=131072, r=8)', () => {
    expect(() => assertKdfPolicy(scryptParams(131_072, 8), { source: SOURCE })).not.toThrow();
  });

  it('accepts N=1048576 with r=8 (128 MiB)', () => {
    expect(() => assertKdfPolicy(scryptParams(1_048_576, 8), { source: SOURCE })).not.toThrow();
  });

  it('accepts N=16384 with r=32 (64 MiB)', () => {
    expect(() => assertKdfPolicy(scryptParams(16_384, 32), { source: SOURCE })).not.toThrow();
  });

  it('accepts N=262144 with r=32 (1 GiB — at budget limit)', () => {
    expect(() => assertKdfPolicy(scryptParams(262_144, 32), { source: SOURCE })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// scrypt combined memory budget — rejected combinations
// ---------------------------------------------------------------------------
describe('kdfPolicy – scrypt memory cap (rejected)', () => {
  it('rejects N=1048576 with r=32 (4 GiB)', () => {
    expect(() => assertKdfPolicy(scryptParams(1_048_576, 32), { source: SOURCE })).toThrow(/memory/i);
  });

  it('rejects N=524288 with r=32 (2 GiB)', () => {
    expect(() => assertKdfPolicy(scryptParams(524_288, 32), { source: SOURCE })).toThrow(/memory/i);
  });
});
