import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';
import CasError from '../../../../src/domain/errors/CasError.js';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';

const testCrypto = await getTestCryptoAdapter();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// addRecipient — golden path
// ---------------------------------------------------------------------------
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
      expect(buffer.equals(original)).toBe(true);
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

// ---------------------------------------------------------------------------
// removeRecipient
// ---------------------------------------------------------------------------
describe('CasService – removeRecipient', () => { // eslint-disable-line max-lines-per-function
  let service;
  beforeEach(() => { ({ service } = setup()); });

  it('removes a recipient, remaining can restore, removed cannot', async () => {
    const alice = randomBytes(32);
    const bob = randomBytes(32);
    const original = Buffer.from('shared data');

    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'rm',
      filename: 'rm.bin',
      recipients: [
        { label: 'alice', key: alice },
        { label: 'bob', key: bob },
      ],
    });

    const updated = await service.removeRecipient({ manifest, label: 'bob' });
    expect(updated.encryption.recipients).toHaveLength(1);
    expect(updated.encryption.recipients[0].label).toBe('alice');

    // Alice can still restore
    const { buffer } = await service.restore({ manifest: updated, encryptionKey: alice });
    expect(buffer.equals(original)).toBe(true);

    // Bob cannot
    try {
      await service.restore({ manifest: updated, encryptionKey: bob });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.code).toBe('NO_MATCHING_RECIPIENT');
    }
  });

  it('nonexistent label → RECIPIENT_NOT_FOUND', async () => {
    const key = randomBytes(32);

    const manifest = await service.store({
      source: bufferSource(Buffer.from('x')),
      slug: 'test',
      filename: 'test.bin',
      recipients: [{ label: 'alice', key }],
    });

    try {
      await service.removeRecipient({ manifest, label: 'eve' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('RECIPIENT_NOT_FOUND');
    }
  });

  it('last recipient → CANNOT_REMOVE_LAST_RECIPIENT', async () => {
    const key = randomBytes(32);

    const manifest = await service.store({
      source: bufferSource(Buffer.from('x')),
      slug: 'test',
      filename: 'test.bin',
      recipients: [{ label: 'alice', key }],
    });

    try {
      await service.removeRecipient({ manifest, label: 'alice' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('CANNOT_REMOVE_LAST_RECIPIENT');
    }
  });

  it('non-envelope manifest → INVALID_OPTIONS', async () => {
    const manifest = await service.store({
      source: bufferSource(Buffer.from('data')),
      slug: 'test',
      filename: 'test.bin',
      encryptionKey: randomBytes(32),
    });

    try {
      await service.removeRecipient({ manifest, label: 'alice' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('INVALID_OPTIONS');
    }
  });

  it('unencrypted manifest → INVALID_OPTIONS', async () => {
    const manifest = await service.store({
      source: bufferSource(Buffer.from('data')),
      slug: 'test',
      filename: 'test.bin',
    });

    try {
      await service.removeRecipient({ manifest, label: 'alice' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('INVALID_OPTIONS');
    }
  });

  it('duplicate-label manifest → post-filter guard prevents zero recipients', async () => {
    const alice = randomBytes(32);
    const bob = randomBytes(32);

    // Create a valid 2-recipient manifest, then tamper to create duplicate labels
    const manifest = await service.store({
      source: bufferSource(Buffer.from('data')),
      slug: 'test',
      filename: 'test.bin',
      recipients: [
        { label: 'alice', key: alice },
        { label: 'bob', key: bob },
      ],
    });

    const json = manifest.toJSON();
    // Overwrite bob's entry label with 'alice' to simulate duplicates
    json.encryption.recipients[1] = { ...json.encryption.recipients[1], label: 'alice' };
    const tampered = new Manifest(json);

    try {
      await service.removeRecipient({ manifest: tampered, label: 'alice' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('CANNOT_REMOVE_LAST_RECIPIENT');
    }
  });
});

// ---------------------------------------------------------------------------
// listRecipients
// ---------------------------------------------------------------------------
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
