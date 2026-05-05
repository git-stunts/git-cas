import { describe, it, expect, vi } from 'vitest';
import StoreStrategy from '../../../../src/domain/strategies/StoreStrategy.js';

describe('StoreStrategy', () => {
  it('selects convergent when the config is convergent', () => {
    const strategies = { plain: {}, convergent: {}, framed: {}, whole: {} };

    expect(StoreStrategy.for({
      keyInfo: { key: new Uint8Array(32) },
      encryptionConfig: { scheme: 'convergent' },
      chunker: { strategy: 'fixed' },
      observability: { log: vi.fn() },
      strategies,
    })).toBe(strategies.convergent);
  });

  it('selects plaintext when no key is available', () => {
    const strategies = { plain: {}, convergent: {}, framed: {}, whole: {} };

    expect(StoreStrategy.for({
      keyInfo: {},
      chunker: { strategy: 'fixed' },
      observability: { log: vi.fn() },
      strategies,
    })).toBe(strategies.plain);
  });
});
