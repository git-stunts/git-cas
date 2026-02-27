import { describe, it, expect, vi } from 'vitest';
import { makeCtx } from './_testContext.js';

vi.mock('../../../bin/ui/context.js', () => ({
  getCliContext: () => makeCtx(),
}));

const { renderEncryptionCard } = await import('../../../bin/ui/encryption-card.js');

describe('renderEncryptionCard', () => {
  it('renders no-encryption for null metadata', () => {
    expect(renderEncryptionCard({ metadata: null })).toContain('No encryption configured');
  });

  it('renders no-encryption for metadata without encryption', () => {
    expect(renderEncryptionCard({ metadata: { version: 1 } })).toContain('No encryption configured');
  });

  it('renders pbkdf2 details', () => {
    const output = renderEncryptionCard({
      metadata: {
        version: 1,
        encryption: { cipher: 'aes-256-gcm', kdf: { algorithm: 'pbkdf2', salt: 'c2FsdHNhbHRzYWx0', iterations: 600000, keyLength: 32 } },
      },
    });
    expect(output).toContain('aes-256-gcm');
    expect(output).toContain('pbkdf2');
    expect(output).toMatch(/600[,.]?000/);
    expect(output).toContain('32 bytes');
    expect(output).toContain('locked');
  });

  it('renders scrypt details', () => {
    const output = renderEncryptionCard({
      metadata: {
        version: 1,
        encryption: { cipher: 'aes-256-gcm', kdf: { algorithm: 'scrypt', salt: 'c2FsdHNhbHRzYWx0', cost: 16, blockSize: 8, parallelization: 1, keyLength: 32 } },
      },
    });
    expect(output).toContain('scrypt');
    expect(output).toContain('16');
  });

  it('shows unlocked badge', () => {
    const output = renderEncryptionCard({
      metadata: {
        version: 1,
        encryption: { cipher: 'aes-256-gcm', kdf: { algorithm: 'pbkdf2', salt: 'c2FsdHNhbHRzYWx0', iterations: 100000, keyLength: 32 } },
      },
      unlocked: true,
    });
    expect(output).toContain('unlocked');
  });
});
