import { describe, it, expect, vi } from 'vitest';
import VaultService from '../../../src/domain/services/VaultService.js';
import buildKdfMetadata from '../../../src/domain/helpers/buildKdfMetadata.js';
import { decodeBase64 } from '../../../src/domain/encoding/base64.js';
import { getTestCryptoAdapter } from '../../helpers/crypto-adapter.js';

const testCrypto = await getTestCryptoAdapter();

function mockObservability() {
  return { metric: vi.fn(), log: vi.fn(), span: vi.fn().mockReturnValue({ end: vi.fn() }) };
}

function treeEntries(metaOid, extras = []) {
  return [
    { mode: '100644', type: 'blob', oid: metaOid, name: '.vault.json' },
    ...extras,
  ];
}

function createVault({ persistence, ref, crypto = testCrypto } = {}) {
  return new VaultService({
    persistence,
    ref,
    crypto,
    observability: mockObservability(),
  });
}

function mockWriterRef() {
  return {
    resolveRef: vi.fn().mockRejectedValueOnce(new Error('not found')),
    resolveTree: vi.fn(),
    createCommit: vi.fn().mockResolvedValue('commit-new'),
    updateRef: vi.fn().mockResolvedValue(undefined),
  };
}

function mockWriterPersistence() {
  return {
    writeBlob: vi.fn().mockResolvedValue('metadata-blob'),
    writeTree: vi.fn().mockResolvedValue('tree-new'),
    readBlob: vi.fn(),
    readTree: vi.fn(),
  };
}

function parseWrittenMetadata(persistence, index = 0) {
  return JSON.parse(Buffer.from(persistence.writeBlob.mock.calls[index][0]).toString());
}

function createReader(metadata) {
  const persistence = {
    writeBlob: vi.fn(),
    writeTree: vi.fn(),
    readBlob: vi.fn().mockResolvedValue(Buffer.from(JSON.stringify(metadata))),
    readTree: vi.fn().mockResolvedValue(treeEntries('metadata-blob')),
  };
  const ref = {
    resolveRef: vi.fn().mockResolvedValue('commit-current'),
    resolveTree: vi.fn().mockResolvedValue('tree-current'),
    createCommit: vi.fn(),
    updateRef: vi.fn(),
  };
  return createVault({ persistence, ref });
}

async function deriveVaultKey(metadata, passphrase) {
  const { kdf } = metadata.encryption;
  const { key } = await testCrypto.deriveKey({
    passphrase,
    salt: decodeBase64(kdf.salt),
    algorithm: kdf.algorithm,
    iterations: kdf.iterations,
    cost: kdf.cost,
    blockSize: kdf.blockSize,
    parallelization: kdf.parallelization,
    keyLength: kdf.keyLength,
  });
  return key;
}

describe('VaultService encrypted vault verifier', () => {
  it('writes verifier metadata during encrypted vault initialization', async () => {
    const persistence = mockWriterPersistence();
    const vault = createVault({ persistence, ref: mockWriterRef() });

    await vault.initVault({
      passphrase: 'correct horse battery staple',
      kdfOptions: { algorithm: 'pbkdf2', iterations: 100_000 },
    });

    const metadata = parseWrittenMetadata(persistence);
    expect(metadata.encryption.verifier).toMatchObject({
      version: 1,
      ciphertext: expect.any(String),
      meta: expect.objectContaining({
        algorithm: 'aes-256-gcm',
        encrypted: true,
        nonce: expect.any(String),
        tag: expect.any(String),
      }),
    });
  });

  it('rejects wrong keys against the encrypted vault verifier', async () => {
    const persistence = mockWriterPersistence();
    const vault = createVault({ persistence, ref: mockWriterRef() });
    await vault.initVault({
      passphrase: 'right-passphrase',
      kdfOptions: { algorithm: 'pbkdf2', iterations: 100_000 },
    });

    const metadata = parseWrittenMetadata(persistence);
    const rightKey = await deriveVaultKey(metadata, 'right-passphrase');
    const wrongKey = await deriveVaultKey(metadata, 'wrong-passphrase');
    await expect(createReader(metadata).readState({ encryptionKey: rightKey }))
      .resolves.toMatchObject({ metadata });
    await expect(createReader(metadata).readState({ encryptionKey: wrongKey }))
      .rejects.toMatchObject({
        code: 'INTEGRITY_ERROR',
        message: expect.stringContaining('Vault passphrase verification failed'),
      });
  });
});

describe('VaultService verifier migration', () => {
  it('adds missing verifier metadata on the next encrypted vault write with a key', async () => {
    const { key, salt, params } = await testCrypto.deriveKey({
      passphrase: 'legacy-passphrase',
      algorithm: 'pbkdf2',
      iterations: 100_000,
    });
    const legacyMetadata = {
      version: 1,
      encryption: {
        cipher: 'aes-256-gcm',
        kdf: buildKdfMetadata(salt, params),
      },
    };
    const persistence = mockWriterPersistence();
    persistence.readTree.mockResolvedValue(treeEntries('metadata-blob'));
    persistence.readBlob.mockResolvedValue(Buffer.from(JSON.stringify(legacyMetadata)));
    const ref = {
      resolveRef: vi.fn().mockResolvedValue('commit-current'),
      resolveTree: vi.fn().mockResolvedValue('tree-current'),
      createCommit: vi.fn().mockResolvedValue('commit-new'),
      updateRef: vi.fn().mockResolvedValue(undefined),
    };
    const vault = createVault({ persistence, ref });

    await vault.addToVault({
      slug: 'legacy/asset',
      treeOid: 'tree-asset',
      encryptionKey: key,
    });

    const migratedMetadata = parseWrittenMetadata(persistence);
    expect(migratedMetadata.encryption.verifier).toBeDefined();
    await expect(createReader(migratedMetadata).readState({ encryptionKey: key }))
      .resolves.toMatchObject({ metadata: migratedMetadata });
  });
});
