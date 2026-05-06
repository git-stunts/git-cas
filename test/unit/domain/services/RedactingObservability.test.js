import { describe, expect, it, vi } from 'vitest';
import RedactingObservability from '../../../../src/domain/services/RedactingObservability.js';

function createObserver() {
  const spanEnd = vi.fn();
  return {
    metric: vi.fn(),
    log: vi.fn(),
    span: vi.fn().mockReturnValue({ end: spanEnd }),
    spanEnd,
  };
}

function expectRedactedTelemetry(observer) {
  const expected = {
    passphrase: '[REDACTED]',
    encryptionKey: '[REDACTED]',
    nested: {
      salt: '[REDACTED]',
      harmless: 'visible',
    },
  };

  expect(observer.metric).toHaveBeenCalledWith('error', expected);
  expect(observer.log).toHaveBeenCalledWith('warn', 'metadata check', expected);
}

function sensitiveMetadata() {
  return {
    passphrase: 'super-secret',
    encryptionKey: new Uint8Array([1, 2, 3]),
    nested: {
      salt: 'raw-salt',
      harmless: 'visible',
    },
  };
}

describe('RedactingObservability', () => {
  it('redacts sensitive fields before forwarding metrics and logs', () => {
    const observer = createObserver();
    const wrapped = RedactingObservability.wrap(observer);
    const metadata = sensitiveMetadata();

    wrapped.metric('error', metadata);
    wrapped.log('warn', 'metadata check', metadata);

    expectRedactedTelemetry(observer);
    expect(metadata.encryptionKey).toBeInstanceOf(Uint8Array);
    expect(metadata.nested.salt).toBe('raw-salt');
  });

  it('redacts span end metadata and normalizes error objects', () => {
    const observer = createObserver();
    const wrapped = RedactingObservability.wrap(observer);
    const err = new Error('boom');
    err.passphrase = 'leaked';
    err.meta = { vaultEncryptionKey: new Uint8Array([9]) };

    const span = wrapped.span('restore');
    span.end({ originalError: err, slug: 'demo/asset' });

    expect(observer.span).toHaveBeenCalledWith('restore');
    expect(observer.spanEnd).toHaveBeenCalledWith({
      originalError: {
        name: 'Error',
        message: 'boom',
        passphrase: '[REDACTED]',
        meta: { vaultEncryptionKey: '[REDACTED]' },
      },
      slug: 'demo/asset',
    });
  });
});
