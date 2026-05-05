import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  deriveVaultKey,
  validateAgentCredentialSources,
  resolveCliEncryptionKey,
  validateCliCredentialSources,
} from '../../../bin/credentials.js';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function encodedSalt(value) {
  return Buffer.from(value).toString('base64');
}

describe('shared vault key derivation', () => {
  it('derives and verifies vault keys through one shared helper', async () => {
    const key = new Uint8Array(32).fill(7);
    const cas = {
      deriveKey: vi.fn(async () => ({ key })),
      verifyVaultKey: vi.fn(async () => ({ verified: true, requiresMigration: false })),
    };
    const metadata = {
      encryption: {
        kdf: {
          algorithm: 'scrypt',
          salt: encodedSalt('vault-salt'),
          cost: 16384,
          blockSize: 8,
          parallelization: 1,
          keyLength: 32,
        },
      },
    };

    await expect(deriveVaultKey(cas, metadata, 'correct horse')).resolves.toBe(key);

    expect(cas.deriveKey).toHaveBeenCalledWith({
      passphrase: 'correct horse',
      salt: Buffer.from('vault-salt'),
      algorithm: 'scrypt',
      iterations: undefined,
      cost: 16384,
      blockSize: 8,
      parallelization: 1,
      keyLength: 32,
    });
    expect(cas.verifyVaultKey).toHaveBeenCalledWith({ encryptionKey: key });
  });
});

describe('shared credential-source validation', () => {
  it('keeps human CLI key-file and passphrase-source conflict validation shared', () => {
    expect(() =>
      validateCliCredentialSources({
        keyFile: '/tmp/key.bin',
        osKeychainTarget: 'demo/passphrase',
      })
    ).toThrow('Provide --key-file or a vault passphrase source, not both');
  });

  it('keeps agent key-file and passphrase-source conflict validation shared', () => {
    expect(() =>
      validateAgentCredentialSources({
        keyFile: '',
        vaultPassphraseFile: '/tmp/passphrase',
      })
    ).toThrow('Provide --key-file or a vault passphrase source, not both');
  });
});

describe('human CLI encryption key resolution', () => {
  it('warns instead of deriving when a passphrase source is provided for an unencrypted vault', async () => {
    const cas = {
      getVaultMetadata: vi.fn(async () => ({ version: 1 })),
    };
    const resolvePassphrase = vi.fn();
    const writeWarning = vi.fn();

    await expect(
      resolveCliEncryptionKey(cas, { vaultPassphrase: 'secret' }, {
        hasPassphraseSource: () => true,
        resolvePassphrase,
        writeWarning,
      })
    ).resolves.toBeUndefined();

    expect(writeWarning).toHaveBeenCalledWith('warning: passphrase ignored (vault is not encrypted)\n');
    expect(resolvePassphrase).not.toHaveBeenCalled();
  });
});

describe('credential resolution module boundaries', () => {
  it('keeps human and agent entrypoints free of local vault-key derivation copies', () => {
    const humanCli = read('bin/git-cas.js');
    const agentCommands = read('bin/agent/commands/index.js');

    for (const source of [humanCli, agentCommands]) {
      expect(source).not.toMatch(/async function deriveVaultKey/);
      expect(source).not.toMatch(/async function resolveEncryptionKey/);
      expect(source).not.toMatch(/async function resolveStoreEncryptionKey/);
      expect(source).not.toMatch(/async function resolveRestoreEncryptionKey/);
    }
  });
});
