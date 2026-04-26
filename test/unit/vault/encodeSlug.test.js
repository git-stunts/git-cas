import { describe, it, expect, vi, beforeEach } from 'vitest';
import VaultService from '../../../src/domain/services/VaultService.js';

/**
 * Tests that control characters in slug values are rejected before they
 * can corrupt git mktree input during vault tree rebuilds.
 *
 * VaultService.writeCommit uses encodeSlug internally. If a tampered
 * vault tree introduces slugs with \0, \n, or \t, the rebuild must fail.
 */

function createVault() {
  return new VaultService({
    persistence: {
      writeBlob: vi.fn().mockResolvedValue('a'.repeat(40)),
      writeTree: vi.fn().mockResolvedValue('a'.repeat(40)),
      readBlob: vi.fn(),
      readTree: vi.fn(),
    },
    ref: {
      createCommit: vi.fn().mockResolvedValue('a'.repeat(40)),
      updateRef: vi.fn(),
    },
    codec: { encode: JSON.stringify, extension: 'json' },
    crypto: {},
  });
}

describe('writeCommit – rejects control characters in slugs', () => {
  let vault;
  beforeEach(() => { vault = createVault(); });

  const baseArgs = {
    metadata: { version: 1 },
    parentCommitOid: 'a'.repeat(40),
    message: 'test',
  };

  it('rejects slug containing NUL byte', async () => {
    const entries = new Map([["test\x00evil", 'b'.repeat(40)]]);
    await expect(vault.writeCommit({ entries, ...baseArgs }))
      .rejects.toThrow(/control/i);
  });

  it('rejects slug containing newline', async () => {
    const entries = new Map([["test\nevil", 'b'.repeat(40)]]);
    await expect(vault.writeCommit({ entries, ...baseArgs }))
      .rejects.toThrow(/control/i);
  });

  it('rejects slug containing tab', async () => {
    const entries = new Map([["test\tevil", 'b'.repeat(40)]]);
    await expect(vault.writeCommit({ entries, ...baseArgs }))
      .rejects.toThrow(/control/i);
  });

  it('accepts a clean slug', async () => {
    const entries = new Map([['valid-slug', 'b'.repeat(40)]]);
    await expect(vault.writeCommit({ entries, ...baseArgs })).resolves.toBeDefined();
  });
});
