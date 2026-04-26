import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';
import CasError from '../../../../src/domain/errors/CasError.js';

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

  return { service, blobStore, crypto, mockPersistence };
}

async function* bufferSource(buf) {
  yield buf;
}

// ---------------------------------------------------------------------------
// rotateKey — golden path
// ---------------------------------------------------------------------------
describe('CasService – rotateKey', () => { // eslint-disable-line max-lines-per-function
  let service;
  let mockPersistence;
  beforeEach(() => { ({ service, mockPersistence } = setup()); });

  it('store → rotateKey → restore with newKey works, oldKey fails', async () => {
    const alice = randomBytes(32);
    const aliceNew = randomBytes(32);
    const original = Buffer.from('rotate me');

    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'rotate',
      filename: 'rotate.bin',
      recipients: [{ label: 'alice', key: alice }],
    });

    const rotated = await service.rotateKey({ manifest, oldKey: alice, newKey: aliceNew });

    // New key works
    const { buffer } = await service.restore({ manifest: rotated, encryptionKey: aliceNew });
    expect(buffer.equals(original)).toBe(true);

    // Old key fails
    try {
      await service.restore({ manifest: rotated, encryptionKey: alice });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.code).toBe('NO_MATCHING_RECIPIENT');
    }
  });

  it('keyVersion increments correctly (manifest-level and recipient-level)', async () => {
    const key1 = randomBytes(32);
    const key2 = randomBytes(32);

    const manifest = await service.store({
      source: bufferSource(Buffer.from('data')),
      slug: 'ver',
      filename: 'ver.bin',
      recipients: [{ label: 'alice', key: key1 }],
    });

    // First rotation
    const r1 = await service.rotateKey({ manifest, oldKey: key1, newKey: key2 });
    expect(r1.encryption.keyVersion).toBe(1);
    expect(r1.encryption.recipients[0].keyVersion).toBe(1);

    // Second rotation
    const key3 = randomBytes(32);
    const r2 = await service.rotateKey({ manifest: r1, oldKey: key2, newKey: key3 });
    expect(r2.encryption.keyVersion).toBe(2);
    expect(r2.encryption.recipients[0].keyVersion).toBe(2);
  });

  it('zero readBlob calls during rotation', async () => {
    const alice = randomBytes(32);
    const aliceNew = randomBytes(32);

    const manifest = await service.store({
      source: bufferSource(Buffer.from('data')),
      slug: 'spy',
      filename: 'spy.bin',
      recipients: [{ label: 'alice', key: alice }],
    });

    const readSpy = vi.spyOn(mockPersistence, 'readBlob');
    await service.rotateKey({ manifest, oldKey: alice, newKey: aliceNew });
    expect(readSpy).not.toHaveBeenCalled();
    readSpy.mockRestore();
  });

  it('with label: only named recipient updated, others unchanged', async () => {
    const alice = randomBytes(32);
    const bob = randomBytes(32);
    const aliceNew = randomBytes(32);
    const original = Buffer.from('multi-recipient');

    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'multi',
      filename: 'multi.bin',
      recipients: [
        { label: 'alice', key: alice },
        { label: 'bob', key: bob },
      ],
    });

    const rotated = await service.rotateKey({
      manifest, oldKey: alice, newKey: aliceNew, label: 'alice',
    });

    // Alice's new key works
    const { buffer: buf1 } = await service.restore({ manifest: rotated, encryptionKey: aliceNew });
    expect(buf1.equals(original)).toBe(true);

    // Bob's key still works (unchanged)
    const { buffer: buf2 } = await service.restore({ manifest: rotated, encryptionKey: bob });
    expect(buf2.equals(original)).toBe(true);

    // Bob's entry is byte-identical
    expect(rotated.encryption.recipients[1].wrappedDek).toBe(manifest.encryption.recipients[1].wrappedDek);
    expect(rotated.encryption.recipients[1].nonce).toBe(manifest.encryption.recipients[1].nonce);
    expect(rotated.encryption.recipients[1].tag).toBe(manifest.encryption.recipients[1].tag);
  });

  it('without label: auto-detects matched entry', async () => {
    const alice = randomBytes(32);
    const bob = randomBytes(32);
    const aliceNew = randomBytes(32);

    const manifest = await service.store({
      source: bufferSource(Buffer.from('auto')),
      slug: 'auto',
      filename: 'auto.bin',
      recipients: [
        { label: 'alice', key: alice },
        { label: 'bob', key: bob },
      ],
    });

    const rotated = await service.rotateKey({ manifest, oldKey: alice, newKey: aliceNew });

    // Alice's new key works
    const { buffer } = await service.restore({ manifest: rotated, encryptionKey: aliceNew });
    expect(buffer.equals(Buffer.from('auto'))).toBe(true);
  });

  it('wrong oldKey → NO_MATCHING_RECIPIENT', async () => {
    const alice = randomBytes(32);
    const wrong = randomBytes(32);

    const manifest = await service.store({
      source: bufferSource(Buffer.from('data')),
      slug: 'wrong',
      filename: 'wrong.bin',
      recipients: [{ label: 'alice', key: alice }],
    });

    try {
      await service.rotateKey({ manifest, oldKey: wrong, newKey: randomBytes(32) });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('NO_MATCHING_RECIPIENT');
    }
  });

  it('wrong oldKey with label → DEK_UNWRAP_FAILED', async () => {
    const alice = randomBytes(32);
    const wrong = randomBytes(32);

    const manifest = await service.store({
      source: bufferSource(Buffer.from('data')),
      slug: 'wrong-label',
      filename: 'wrong-label.bin',
      recipients: [{ label: 'alice', key: alice }],
    });

    try {
      await service.rotateKey({ manifest, oldKey: wrong, newKey: randomBytes(32), label: 'alice' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('DEK_UNWRAP_FAILED');
    }
  });

  it('nonexistent label → RECIPIENT_NOT_FOUND', async () => {
    const alice = randomBytes(32);

    const manifest = await service.store({
      source: bufferSource(Buffer.from('data')),
      slug: 'no-label',
      filename: 'no-label.bin',
      recipients: [{ label: 'alice', key: alice }],
    });

    try {
      await service.rotateKey({ manifest, oldKey: alice, newKey: randomBytes(32), label: 'eve' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('RECIPIENT_NOT_FOUND');
    }
  });

  it('legacy manifest (no recipients) → ROTATION_NOT_SUPPORTED', async () => {
    const manifest = await service.store({
      source: bufferSource(Buffer.from('data')),
      slug: 'legacy',
      filename: 'legacy.bin',
      encryptionKey: randomBytes(32),
    });

    try {
      await service.rotateKey({ manifest, oldKey: randomBytes(32), newKey: randomBytes(32) });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('ROTATION_NOT_SUPPORTED');
    }
  });

  it('unencrypted manifest → ROTATION_NOT_SUPPORTED', async () => {
    const manifest = await service.store({
      source: bufferSource(Buffer.from('data')),
      slug: 'plain',
      filename: 'plain.bin',
    });

    try {
      await service.rotateKey({ manifest, oldKey: randomBytes(32), newKey: randomBytes(32) });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('ROTATION_NOT_SUPPORTED');
    }
  });

  it('20 sequential rotations → keyVersion=20, only final key works', async () => {
    let currentKey = randomBytes(32);
    const original = Buffer.from('sequential rotation');

    let manifest = await service.store({
      source: bufferSource(original),
      slug: 'seq',
      filename: 'seq.bin',
      recipients: [{ label: 'alice', key: currentKey }],
    });

    for (let i = 0; i < 20; i++) {
      const nextKey = randomBytes(32);
      manifest = await service.rotateKey({ manifest, oldKey: currentKey, newKey: nextKey });
      currentKey = nextKey;
    }

    expect(manifest.encryption.keyVersion).toBe(20);
    expect(manifest.encryption.recipients[0].keyVersion).toBe(20);

    // Final key works
    const { buffer } = await service.restore({ manifest, encryptionKey: currentKey });
    expect(buffer.equals(original)).toBe(true);

    // A random older key fails
    try {
      await service.restore({ manifest, encryptionKey: randomBytes(32) });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.code).toBe('NO_MATCHING_RECIPIENT');
    }
  });
});
