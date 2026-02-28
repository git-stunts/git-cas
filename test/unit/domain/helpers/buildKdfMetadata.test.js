import { describe, it, expect } from 'vitest';
import buildKdfMetadata from '../../../../src/domain/helpers/buildKdfMetadata.js';

describe('buildKdfMetadata', () => {
  it('builds PBKDF2 metadata with iterations', () => {
    const salt = Buffer.from('test-salt');
    const params = { algorithm: 'pbkdf2', iterations: 100000, keyLength: 32 };

    const result = buildKdfMetadata(salt, params);

    expect(result).toEqual({
      algorithm: 'pbkdf2',
      salt: salt.toString('base64'),
      iterations: 100000,
      keyLength: 32,
    });
  });

  it('builds scrypt metadata with cost/blockSize/parallelization', () => {
    const salt = Buffer.from('scrypt-salt');
    const params = { algorithm: 'scrypt', cost: 16384, blockSize: 8, parallelization: 1, keyLength: 32 };

    const result = buildKdfMetadata(salt, params);

    expect(result).toEqual({
      algorithm: 'scrypt',
      salt: salt.toString('base64'),
      cost: 16384,
      blockSize: 8,
      parallelization: 1,
      keyLength: 32,
    });
  });

  it('omits optional fields when absent', () => {
    const salt = Buffer.from('minimal');
    const params = { algorithm: 'pbkdf2', keyLength: 32 };

    const result = buildKdfMetadata(salt, params);

    expect(result).toEqual({
      algorithm: 'pbkdf2',
      salt: salt.toString('base64'),
      keyLength: 32,
    });
    expect(result).not.toHaveProperty('iterations');
    expect(result).not.toHaveProperty('cost');
    expect(result).not.toHaveProperty('blockSize');
    expect(result).not.toHaveProperty('parallelization');
  });
});
