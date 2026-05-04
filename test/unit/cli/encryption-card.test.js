import { describe, it, expect, vi } from 'vitest';
import { surfaceToString } from '@flyingrobots/bijou';
import { makeCtx } from './_testContext.js';

vi.mock('../../../bin/ui/context.js', () => ({
  getCliContext: () => makeCtx(),
}));

const { renderEncryptionCard } = await import('../../../bin/ui/encryption-card.js');

describe('renderEncryptionCard basics', () => {
  it('renders no-encryption for null metadata', () => {
    const ctx = makeCtx();
    const output = surfaceToString(renderEncryptionCard({ metadata: null }), ctx.style);
    expect(output).toContain('No encryption configured');
  });

  it('renders no-encryption for metadata without encryption', () => {
    const ctx = makeCtx();
    const output = surfaceToString(renderEncryptionCard({ metadata: { version: 1 } }), ctx.style);
    expect(output).toContain('No encryption configured');
  });
});

describe('renderEncryptionCard details', () => {
  it('renders pbkdf2 details', () => {
    const ctx = makeCtx();
    const output = surfaceToString(renderEncryptionCard({
      metadata: {
        version: 1,
        encryption: { cipher: 'aes-256-gcm', kdf: { algorithm: 'pbkdf2', salt: 'c2FsdHNhbHRzYWx0', iterations: 600000, keyLength: 32 } },
      },
    }), ctx.style);
    expect(output).toContain('aes-256-gcm');
    expect(output).toContain('pbkdf2');
    expect(output).toMatch(/600[,.]?000/);
    expect(output).toContain('32 bytes');
    expect(output).toContain('locked');
  });

  it('renders scrypt details', () => {
    const ctx = makeCtx();
    const output = surfaceToString(renderEncryptionCard({
      metadata: {
        version: 1,
        encryption: { cipher: 'aes-256-gcm', kdf: { algorithm: 'scrypt', salt: 'c2FsdHNhbHRzYWx0', cost: 16, blockSize: 8, parallelization: 1, keyLength: 32 } },
      },
    }), ctx.style);
    expect(output).toContain('scrypt');
    expect(output).toContain('16');
  });

  it('shows unlocked badge', () => {
    const ctx = makeCtx();
    const output = surfaceToString(renderEncryptionCard({
      metadata: {
        version: 1,
        encryption: { cipher: 'aes-256-gcm', kdf: { algorithm: 'pbkdf2', salt: 'c2FsdHNhbHRzYWx0', iterations: 100000, keyLength: 32 } },
      },
      unlocked: true,
    }), ctx.style);
    expect(output).toContain('unlocked');
  });
});
