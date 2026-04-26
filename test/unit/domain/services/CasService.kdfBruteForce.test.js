import { describe, it, expect, vi } from 'vitest';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';

const testCrypto = await getTestCryptoAdapter();
const base64Bytes = (size, fill) => Buffer.alloc(size, fill).toString('base64');

const CHUNK_DATA = Buffer.alloc(128, 0xaa);
const CHUNK_DIGEST = await testCrypto.sha256(CHUNK_DATA);

function streamOneBuffer(buf) {
  return {
    async *[Symbol.asyncIterator]() {
      yield buf;
    },
  };
}

function setup() {
  const observability = {
    metric: vi.fn(),
    log: vi.fn(),
    span: vi.fn().mockReturnValue({ end: vi.fn() }),
  };
  const mockPersistence = {
    writeBlob: vi.fn(),
    writeTree: vi.fn(),
    readBlob: vi.fn().mockResolvedValue(CHUNK_DATA),
    readBlobStream: vi.fn().mockResolvedValue(streamOneBuffer(CHUNK_DATA)),
    readTree: vi.fn(),
  };
  const service = new CasService({
    persistence: mockPersistence,
    crypto: testCrypto,
    codec: new JsonCodec(),
    chunkSize: 1024,
    observability,
    chunker: new FixedChunker({ chunkSize: 1024 }),
    compressionAdapter: new NodeCompressionAdapter(),
  });
  return { service, observability };
}

function encryptedManifest(slug) {
  return new Manifest({
    slug,
    filename: `${slug}.bin`,
    size: 128,
    chunks: [
      { index: 0, size: 128, digest: CHUNK_DIGEST, blob: 'a'.repeat(40) },
    ],
    encryption: {
      scheme: 'whole',
      algorithm: 'aes-256-gcm',
      nonce: base64Bytes(12, 1),
      tag: base64Bytes(16, 2),
      encrypted: true,
    },
  });
}

describe('16.12: KDF brute-force — decryption_failed metric', () => {
  it('emits metric on wrong key', async () => {
    const { service, observability } = setup();
    const manifest = encryptedManifest('secret-file');
    const wrongKey = testCrypto.randomBytes(32);

    try {
      await service.restore({ manifest, encryptionKey: wrongKey });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.code).toBe('INTEGRITY_ERROR');
    }

    const dfMetrics = observability.metric.mock.calls.filter(
      (c) => c[0] === 'error' && c[1].action === 'decryption_failed',
    );
    expect(dfMetrics.length).toBe(1);
  });

  it('includes slug context for audit trail', async () => {
    const { service, observability } = setup();
    const manifest = encryptedManifest('audit-slug');
    const wrongKey = testCrypto.randomBytes(32);

    try {
      await service.restore({ manifest, encryptionKey: wrongKey });
    } catch {
      // expected
    }

    const dfMetrics = observability.metric.mock.calls.filter(
      (c) => c[0] === 'error' && c[1].action === 'decryption_failed',
    );
    expect(dfMetrics[0][1]).toHaveProperty('slug', 'audit-slug');
  });
});

describe('16.12: KDF brute-force — library rate-limiting', () => {
  it('library API does NOT rate-limit', async () => {
    const { service } = setup();
    const manifest = encryptedManifest('rate-test');
    const wrongKey = testCrypto.randomBytes(32);

    const start = Date.now();
    let caught;
    try {
      await service.restore({ manifest, encryptionKey: wrongKey });
      expect.unreachable('should have thrown INTEGRITY_ERROR');
    } catch (err) {
      caught = err;
    }
    const elapsed = Date.now() - start;
    expect(caught?.code).toBe('INTEGRITY_ERROR');
    expect(elapsed).toBeLessThan(500);
  });
});
