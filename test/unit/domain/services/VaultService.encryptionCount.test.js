import { describe, it, expect, vi } from 'vitest';
import VaultService from '../../../../src/domain/services/VaultService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';

const testCrypto = await getTestCryptoAdapter();

function encryptedMetadata(overrides = {}) {
  return {
    version: 1,
    encryption: {
      cipher: 'aes-256-gcm',
      kdf: { algorithm: 'pbkdf2', salt: 'qqqqqqqqqqqqqqqqqqqqqg==', iterations: 100000, keyLength: 32 },
    },
    ...overrides,
  };
}

function setup(metadata = encryptedMetadata()) {
  const observability = {
    metric: vi.fn(),
    log: vi.fn(),
    span: vi.fn().mockReturnValue({ end: vi.fn() }),
  };
  const persistence = {
    writeBlob: vi.fn().mockResolvedValue('blob-oid'),
    writeTree: vi.fn().mockResolvedValue('tree-oid'),
    readBlob: vi.fn().mockResolvedValue(Buffer.from(JSON.stringify(metadata))),
    readTree: vi.fn().mockResolvedValue([
      { mode: '100644', type: 'blob', oid: 'meta-oid', name: '.vault.json' },
    ]),
  };
  const ref = {
    resolveRef: vi.fn().mockResolvedValue('commit-oid'),
    resolveTree: vi.fn().mockResolvedValue('root-tree-oid'),
    createCommit: vi.fn().mockResolvedValue('new-commit-oid'),
    updateRef: vi.fn().mockResolvedValue(undefined),
  };
  const vault = new VaultService({
    persistence, ref, crypto: testCrypto, observability,
  });
  return { vault, persistence, ref, observability };
}

describe('16.13: Nonce usage tracking — encryptionCount', () => {
  it('vault metadata includes encryptionCount after add', async () => {
    const { vault, persistence } = setup();
    await vault.addToVault({ slug: 'asset-1', treeOid: 'tree-1' });

    const writtenMetadata = JSON.parse(persistence.writeBlob.mock.calls[0][0]);
    expect(writtenMetadata).toHaveProperty('encryptionCount', 1);
  });

  it('encryptionCount increments per encrypted store', async () => {
    const meta = encryptedMetadata({ encryptionCount: 5 });
    const { vault, persistence } = setup(meta);
    await vault.addToVault({ slug: 'asset-2', treeOid: 'tree-2' });

    const writtenMetadata = JSON.parse(persistence.writeBlob.mock.calls[0][0]);
    expect(writtenMetadata.encryptionCount).toBe(6);
  });
});

describe('16.13: Nonce usage tracking — threshold warning', () => {
  it('warns when encryptionCount exceeds threshold', async () => {
    const threshold = VaultService.ENCRYPTION_COUNT_WARN;
    const meta = encryptedMetadata({ encryptionCount: threshold - 1 });
    const { vault, observability } = setup(meta);
    await vault.addToVault({ slug: 'asset-3', treeOid: 'tree-3' });

    const warnCalls = observability.log.mock.calls.filter(
      (c) => c[0] === 'warn' && c[1].includes('encryption count'),
    );
    expect(warnCalls.length).toBe(1);
  });

  it('no warning below threshold', async () => {
    const meta = encryptedMetadata({ encryptionCount: 0 });
    const { vault, observability } = setup(meta);
    await vault.addToVault({ slug: 'asset-4', treeOid: 'tree-4' });

    const warnCalls = observability.log.mock.calls.filter(
      (c) => c[0] === 'warn' && c[1].includes('encryption count'),
    );
    expect(warnCalls.length).toBe(0);
  });

  it('no counter increment for unencrypted vault', async () => {
    const meta = { version: 1 };
    const { vault, persistence } = setup(meta);
    await vault.addToVault({ slug: 'plain-1', treeOid: 'tree-p' });

    const writtenMetadata = JSON.parse(persistence.writeBlob.mock.calls[0][0]);
    expect(writtenMetadata).not.toHaveProperty('encryptionCount');
  });
});
