import { describe, it, expect, vi } from 'vitest';
import StoreEncryptionConfig from '../../../../src/domain/value-objects/StoreEncryptionConfig.js';

describe('StoreEncryptionConfig', () => {
  it('returns undefined when no key is available', () => {
    expect(StoreEncryptionConfig.resolve({
      encryption: undefined,
      hasEncryptionKey: false,
      chunker: { strategy: 'fixed' },
      observability: { log: vi.fn() },
    })).toBeUndefined();
  });

  it('freezes framed configuration', () => {
    const config = StoreEncryptionConfig.resolveFramed(1024);

    expect(config.scheme).toBe('framed');
    expect(config.frameBytes).toBe(1024);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('auto-selects convergent encryption for CDC and emits the warning', () => {
    const observability = { log: vi.fn() };
    const config = StoreEncryptionConfig.resolve({
      encryption: undefined,
      hasEncryptionKey: true,
      chunker: { strategy: 'cdc' },
      observability,
    });

    expect(config.scheme).toBe('convergent');
    expect(observability.log).toHaveBeenCalledWith('warn', expect.any(String), expect.objectContaining({ selectedScheme: 'convergent' }));
  });
});
