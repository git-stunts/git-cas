import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';
import CasError from '../../../../src/domain/errors/CasError.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';

const testCrypto = await getTestCryptoAdapter();

function digestOf(seed) {
  return createHash('sha256').update(seed).digest('hex');
}

const BLOB_0 = 'a'.repeat(40);
const BLOB_1 = 'b'.repeat(40);

function oid(label) {
  return createHash('sha1').update(label).digest('hex');
}

function validEncryptedManifest(schemeOverride) {
  return {
    slug: 'test-asset',
    filename: 'test.bin',
    size: 2048,
    chunks: [
      { index: 0, size: 1024, digest: digestOf('chunk-0'), blob: BLOB_0 },
      { index: 1, size: 1024, digest: digestOf('chunk-1'), blob: BLOB_1 },
    ],
    encryption: {
      scheme: schemeOverride,
      algorithm: 'aes-256-gcm',
      encrypted: true,
      nonce: Buffer.alloc(12, 1).toString('base64'),
      tag: Buffer.alloc(16, 2).toString('base64'),
    },
  };
}

function schemelessEncryptedManifest() {
  return {
    slug: 'test-asset',
    filename: 'test.bin',
    size: 1024,
    chunks: [
      { index: 0, size: 1024, digest: digestOf('chunk-0'), blob: BLOB_0 },
    ],
    encryption: {
      algorithm: 'aes-256-gcm',
      nonce: Buffer.alloc(12, 1).toString('base64'),
      tag: Buffer.alloc(16, 2).toString('base64'),
      encrypted: true,
    },
  };
}

function setup({ legacyMode = false } = {}) {
  const codec = new JsonCodec();
  const mockPersistence = {
    writeBlob: vi.fn().mockResolvedValue(oid('mock-blob-oid')),
    writeTree: vi.fn().mockResolvedValue(oid('mock-tree-oid')),
    readBlob: vi.fn(),
    readTree: vi.fn(),
  };

  const service = new CasService({
    persistence: mockPersistence,
    crypto: testCrypto,
    codec,
    chunkSize: 1024,
    observability: new SilentObserver(),
    chunker: new FixedChunker({ chunkSize: 1024 }),
    compressionAdapter: new NodeCompressionAdapter(),
    legacyMode,
  });

  return { service, mockPersistence, codec };
}

function mockTreeAndBlob(mockPersistence, codec, data) {
  const manifestOid = oid('manifest-oid-456');
  mockPersistence.readTree.mockResolvedValue([
    { mode: '100644', type: 'blob', oid: manifestOid, name: 'manifest.json' },
  ]);
  mockPersistence.readBlob.mockResolvedValue(
    Buffer.from(codec.encode(data)),
  );
}

// ---------------------------------------------------------------------------
// readManifest — legacyMode: false rejects legacy schemes
// ---------------------------------------------------------------------------
describe('CasService.readManifest – legacy scheme rejection', () => {
  it.each([
    'whole-v1', 'whole-v2', 'framed-v1', 'framed-v2', 'convergent-v1',
  ])('throws LEGACY_SCHEME for "%s" in normal mode', async (scheme) => {
    const { service, mockPersistence, codec } = setup();
    const data = validEncryptedManifest(scheme);
    mockTreeAndBlob(mockPersistence, codec, data);

    try {
      await service.readManifest({ treeOid: oid('tree-oid') });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CasError);
      expect(err.code).toBe('LEGACY_SCHEME');
    }
  });
});

// ---------------------------------------------------------------------------
// readManifest — legacyMode: true accepts and maps legacy schemes
// ---------------------------------------------------------------------------
describe('CasService.readManifest – legacyMode whole schemes', () => {
  it.each([
    ['whole-v1', 'whole'],
    ['whole-v2', 'whole'],
  ])('maps "%s" → "%s" and returns Manifest', async (legacy, current) => {
    const { service, mockPersistence, codec } = setup({ legacyMode: true });
    const data = validEncryptedManifest(legacy);
    mockTreeAndBlob(mockPersistence, codec, data);

    const result = await service.readManifest({ treeOid: oid('tree-oid') });

    expect(result).toBeInstanceOf(Manifest);
    expect(result.encryption.scheme).toBe(current);
  });
});

function framedManifestData(scheme) {
  return {
    slug: 'test-asset',
    filename: 'test.bin',
    size: 1024,
    chunks: [
      { index: 0, size: 1024, digest: digestOf('chunk-0'), blob: BLOB_0 },
    ],
    encryption: {
      scheme,
      algorithm: 'aes-256-gcm',
      encrypted: true,
      frameBytes: 65536,
    },
  };
}

describe('CasService.readManifest – legacyMode framed schemes', () => {
  it.each([
    ['framed-v1', 'framed'],
    ['framed-v2', 'framed'],
  ])('maps "%s" → "%s"', async (legacy, current) => {
    const { service, mockPersistence, codec } = setup({ legacyMode: true });
    mockTreeAndBlob(mockPersistence, codec, framedManifestData(legacy));

    const result = await service.readManifest({ treeOid: oid('tree-oid') });

    expect(result).toBeInstanceOf(Manifest);
    expect(result.encryption.scheme).toBe(current);
  });
});

describe('CasService.readManifest – legacyMode convergent', () => {
  it('maps convergent-v1 → convergent', async () => {
    const { service, mockPersistence, codec } = setup({ legacyMode: true });
    const data = {
      slug: 'test-asset',
      filename: 'test.bin',
      size: 1024,
      chunks: [
        { index: 0, size: 1024, digest: digestOf('chunk-0'), blob: BLOB_0 },
      ],
      encryption: {
        scheme: 'convergent-v1',
        algorithm: 'aes-256-gcm',
        encrypted: true,
      },
    };
    mockTreeAndBlob(mockPersistence, codec, data);

    const result = await service.readManifest({ treeOid: oid('tree-oid') });

    expect(result).toBeInstanceOf(Manifest);
    expect(result.encryption.scheme).toBe('convergent');
  });
});

// ---------------------------------------------------------------------------
// readManifestRaw — returns raw decoded object
// ---------------------------------------------------------------------------
describe('CasService.readManifestRaw', () => {
  it('returns raw decoded data without Manifest construction', async () => {
    const { service, mockPersistence, codec } = setup();
    const data = validEncryptedManifest('whole-v1');
    mockTreeAndBlob(mockPersistence, codec, data);

    const raw = await service.readManifestRaw({ treeOid: oid('tree-oid') });

    expect(raw).not.toBeInstanceOf(Manifest);
    expect(raw.slug).toBe('test-asset');
    expect(raw.encryption.scheme).toBe('whole-v1');
  });

  it('preserves legacy scheme names without assertion', async () => {
    const { service, mockPersistence, codec } = setup();
    const data = validEncryptedManifest('framed-v2');
    data.encryption = {
      scheme: 'framed-v2',
      algorithm: 'aes-256-gcm',
      encrypted: true,
      frameBytes: 65536,
    };
    mockTreeAndBlob(mockPersistence, codec, data);

    const raw = await service.readManifestRaw({ treeOid: oid('tree-oid') });

    expect(raw.encryption.scheme).toBe('framed-v2');
  });

  it('reads schemeless encrypted manifest without schema validation', async () => {
    const { service, mockPersistence, codec } = setup();
    const data = schemelessEncryptedManifest();
    mockTreeAndBlob(mockPersistence, codec, data);

    const raw = await service.readManifestRaw({ treeOid: oid('tree-oid') });

    expect(raw.encryption.algorithm).toBe('aes-256-gcm');
    expect(raw.encryption.scheme).toBeUndefined();
    expect(raw.encryption.encrypted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readManifest — legacyMode hash verification with scheme mapping
// ---------------------------------------------------------------------------
// Hash verification must run against the ORIGINAL manifest data (before scheme
// mapping), so a hash computed over the legacy scheme name stays valid.
describe('CasService.readManifest – hash verified before scheme mapping', () => {
  it('manifestHash over original legacy data in legacyMode', async () => {
    const { service, mockPersistence, codec } = setup({ legacyMode: true });
    const data = validEncryptedManifest('whole-v1');
    const encoded = codec.encode({ ...data });
    data.manifestHash = await testCrypto.sha256(Buffer.from(encoded));
    mockTreeAndBlob(mockPersistence, codec, data);

    const result = await service.readManifest({ treeOid: oid('tree-oid') });
    expect(result).toBeInstanceOf(Manifest);
    expect(result.encryption.scheme).toBe('whole');
  });
});
