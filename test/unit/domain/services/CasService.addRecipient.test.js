import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';
import CasError from '../../../../src/domain/errors/CasError.js';

const testCrypto = await getTestCryptoAdapter();

function setup() {
  const crypto = testCrypto;
  const blobStore = new Map();

  const mockPersistence = {
    writeBlob: async (content) => {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
      const oid = await crypto.sha256(buf);
      blobStore.set(oid, buf);
      return oid;
    },
    writeTree: async () => 'mock-tree-oid',
    readBlob: async (oid) => {
      const buf = blobStore.get(oid);
      if (!buf) { throw new Error(`Blob not found: ${oid}`); }
      return buf;
    },
  };

  const service = new CasService({
    persistence: mockPersistence,
    crypto,
    codec: new JsonCodec(),
    chunkSize: 1024,
    observability: new SilentObserver(),
    chunker: new FixedChunker({ chunkSize: 1024 }),
    compressionAdapter: new NodeCompressionAdapter(),
  });

  return { service, blobStore, crypto };
}

async function* bufferSource(buf) {
  yield buf;
}

describe('CasService – addRecipient', () => { // eslint-disable-line max-lines-per-function
  let service;
  beforeEach(() => { ({ service } = setup()); });

  it('adds a recipient, and both can restore', async () => {
    const alice = randomBytes(32);
    const bob = randomBytes(32);
    const original = Buffer.from('shared secret');

    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'shared',
      filename: 'shared.bin',
      recipients: [{ label: 'alice', key: alice }],
    });

    const updated = await service.addRecipient({
      manifest,
      existingKey: alice,
      newRecipientKey: bob,
      label: 'bob',
    });

    expect(updated.encryption.recipients).toHaveLength(2);

    // Both keys can restore
    for (const key of [alice, bob]) {
      const { buffer } = await service.restore({ manifest: updated, encryptionKey: key });
      expect(Buffer.from(buffer).equals(original)).toBe(true);
    }
  });

  it('wrong existingKey → DEK_UNWRAP_FAILED', async () => {
    const alice = randomBytes(32);
    const wrongKey = randomBytes(32);
    const bob = randomBytes(32);

    const manifest = await service.store({
      source: bufferSource(Buffer.from('data')),
      slug: 'test',
      filename: 'test.bin',
      recipients: [{ label: 'alice', key: alice }],
    });

    try {
      await service.addRecipient({
        manifest,
        existingKey: wrongKey,
        newRecipientKey: bob,
        label: 'bob',
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('DEK_UNWRAP_FAILED');
    }
  });

  it('duplicate label → RECIPIENT_ALREADY_EXISTS', async () => {
    const alice = randomBytes(32);
    const bob = randomBytes(32);

    const manifest = await service.store({
      source: bufferSource(Buffer.from('data')),
      slug: 'test',
      filename: 'test.bin',
      recipients: [{ label: 'alice', key: alice }],
    });

    try {
      await service.addRecipient({
        manifest,
        existingKey: alice,
        newRecipientKey: bob,
        label: 'alice',
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('RECIPIENT_ALREADY_EXISTS');
    }
  });

  it('non-envelope manifest → INVALID_OPTIONS', async () => {
    const key = randomBytes(32);

    const manifest = await service.store({
      source: bufferSource(Buffer.from('data')),
      slug: 'test',
      filename: 'test.bin',
      encryptionKey: key,
    });

    try {
      await service.addRecipient({
        manifest,
        existingKey: key,
        newRecipientKey: randomBytes(32),
        label: 'bob',
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('INVALID_OPTIONS');
    }
  });
});
