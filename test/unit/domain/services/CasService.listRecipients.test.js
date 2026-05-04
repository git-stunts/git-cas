import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';

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

describe('CasService – listRecipients', () => {
  let service;
  beforeEach(() => { ({ service } = setup()); });

  it('returns labels from envelope-encrypted manifest', async () => {
    const manifest = await service.store({
      source: bufferSource(Buffer.from('data')),
      slug: 'test',
      filename: 'test.bin',
      recipients: [
        { label: 'alice', key: randomBytes(32) },
        { label: 'bob', key: randomBytes(32) },
      ],
    });

    expect(service.listRecipients(manifest)).toEqual(['alice', 'bob']);
  });

  it('returns empty array for non-envelope encrypted manifest', async () => {
    const manifest = await service.store({
      source: bufferSource(Buffer.from('data')),
      slug: 'test',
      filename: 'test.bin',
      encryptionKey: randomBytes(32),
    });

    expect(service.listRecipients(manifest)).toEqual([]);
  });

  it('returns empty array for unencrypted manifest', async () => {
    const manifest = await service.store({
      source: bufferSource(Buffer.from('data')),
      slug: 'test',
      filename: 'test.bin',
    });

    expect(service.listRecipients(manifest)).toEqual([]);
  });
});
