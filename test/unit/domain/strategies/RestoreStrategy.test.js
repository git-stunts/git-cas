import { describe, it, expect } from 'vitest';
import RestoreStrategy from '../../../../src/domain/strategies/RestoreStrategy.js';

describe('RestoreStrategy', () => {
  it('selects framed strategy by encryption metadata', () => {
    const strategies = { plain: {}, compressed: {}, convergent: {}, framed: {}, whole: {} };

    expect(RestoreStrategy.for({
      manifest: {},
      encryptionMeta: { scheme: 'framed' },
      strategies,
    })).toBe(strategies.framed);
  });

  it('selects compressed plaintext strategy when no encryption is present', () => {
    const strategies = { plain: {}, compressed: {}, convergent: {}, framed: {}, whole: {} };

    expect(RestoreStrategy.for({
      manifest: { compression: { algorithm: 'gzip' } },
      encryptionMeta: undefined,
      strategies,
    })).toBe(strategies.compressed);
  });
});
