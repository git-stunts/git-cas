import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Async iterable that yields a single buffer.
 */
async function* bufferSource(buf) {
  yield buf;
}

/**
 * Builds CasService with an in-memory blob/tree store.
 * @param {number} merkleThreshold Chunk count threshold for Merkle manifests.
 */
function setup(merkleThreshold = 5) {
  const crypto = new NodeCryptoAdapter();
  const blobs = new Map();
  const trees = new Map();
  let treeCounter = 0;
  const mockPersistence = {
    writeBlob: vi.fn().mockImplementation((content) => {
      const oid = crypto.sha256(Buffer.isBuffer(content) ? content : Buffer.from(content));
      blobs.set(oid, Buffer.isBuffer(content) ? content : Buffer.from(content));
      return Promise.resolve(oid);
    }),
    writeTree: vi.fn().mockImplementation((entries) => {
      const oid = `tree-${treeCounter++}`;
      trees.set(oid, entries);
      return Promise.resolve(oid);
    }),
    readBlob: vi.fn().mockImplementation((oid) => {
      const blob = blobs.get(oid);
      if (!blob) {return Promise.reject(new Error(`Blob not found: ${oid}`));}
      return Promise.resolve(blob);
    }),
    readTree: vi.fn().mockImplementation((treeOid) => {
      const entries = trees.get(treeOid);
      if (!entries) {return Promise.reject(new Error(`Tree not found: ${treeOid}`));}
      return Promise.resolve(entries.map((e) => {
        const match = e.match(/^(\d+) (\w+) ([^\t]+)\t(.+)$/);
        return { mode: match[1], type: match[2], oid: match[3], name: match[4] };
      }));
    }),
  };
  const codec = new JsonCodec();
  const service = new CasService({
    persistence: mockPersistence,
    crypto,
    codec,
    chunkSize: 1024,
    merkleThreshold,
  });
  return { mockPersistence, service, blobs, trees, crypto, codec };
}

/**
 * Generates a deterministic buffer of a given size.
 * @param {number} size Size in bytes.
 * @param {number} seed Seed byte for deterministic content.
 */
function generateBuffer(size, seed = 0xAB) {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) {
    buf[i] = (seed + i) & 0xFF;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// 1. v1 manifest when chunks <= threshold
// ---------------------------------------------------------------------------
describe('CasService Merkle – createTree produces v1 manifest when chunks <= threshold', () => {
  it('stores small data and produces a v1 manifest without subManifests', async () => {
    const { service, blobs, codec } = setup(5);

    // 3KB -> 3 chunks with chunkSize=1024 — below threshold of 5
    const data = generateBuffer(3 * 1024);
    const manifest = await service.store({
      source: bufferSource(data),
      slug: 'small-asset',
      filename: 'small.bin',
    });

    expect(manifest.chunks).toHaveLength(3);

    const treeOid = await service.createTree({ manifest });
    expect(treeOid).toMatch(/^tree-/);

    // Find the manifest blob in the store and decode it
    const manifestBlobContent = findManifestBlob(blobs, codec);
    expect(manifestBlobContent).toBeDefined();
    expect(manifestBlobContent.version).toBe(1);
    expect(manifestBlobContent.subManifests).toBeUndefined();
    expect(manifestBlobContent.chunks).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 2. v2 Merkle manifest when chunks > threshold
// ---------------------------------------------------------------------------
describe('CasService Merkle – createTree produces v2 Merkle manifest when chunks > threshold', () => {
  it('stores 6KB+ data and produces a v2 manifest with subManifests', async () => {
    const { service, blobs, codec } = setup(5);

    // 6KB -> 6 chunks with chunkSize=1024 — exceeds threshold of 5
    const data = generateBuffer(6 * 1024);
    const manifest = await service.store({
      source: bufferSource(data),
      slug: 'large-asset',
      filename: 'large.bin',
    });

    expect(manifest.chunks).toHaveLength(6);

    const treeOid = await service.createTree({ manifest });
    expect(treeOid).toMatch(/^tree-/);

    // Decode the root manifest blob
    const rootManifest = findLastManifestBlob(blobs, codec);
    expect(rootManifest).toBeDefined();
    expect(rootManifest.version).toBe(2);
    expect(rootManifest.chunks).toEqual([]);
    expect(rootManifest.subManifests).toBeDefined();
    expect(rootManifest.subManifests.length).toBeGreaterThan(0);

    // With 6 chunks and threshold=5, there should be 2 sub-manifests:
    // group 0: chunks 0-4 (5 chunks), group 1: chunk 5 (1 chunk)
    expect(rootManifest.subManifests).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 3. readManifest reconstitutes v2 manifest into flat chunk list
// ---------------------------------------------------------------------------
describe('CasService Merkle – readManifest reconstitutes v2 manifest into flat chunk list', () => {
  it('reads a v2 tree and returns a Manifest with all chunks populated', async () => {
    const { service } = setup(5);

    const data = generateBuffer(8 * 1024); // 8 chunks
    const manifest = await service.store({
      source: bufferSource(data),
      slug: 'reconstitute-test',
      filename: 'recon.bin',
    });

    expect(manifest.chunks).toHaveLength(8);

    const treeOid = await service.createTree({ manifest });
    const reconstituted = await service.readManifest({ treeOid });

    expect(reconstituted).toBeInstanceOf(Manifest);
    expect(reconstituted.chunks).toHaveLength(8);
    expect(reconstituted.slug).toBe('reconstitute-test');
    expect(reconstituted.filename).toBe('recon.bin');
    expect(reconstituted.size).toBe(8 * 1024);

    // Verify chunk ordering and metadata match
    for (let i = 0; i < 8; i++) {
      expect(reconstituted.chunks[i].index).toBe(i);
      expect(reconstituted.chunks[i].size).toBe(1024);
      expect(reconstituted.chunks[i].digest).toBe(manifest.chunks[i].digest);
      expect(reconstituted.chunks[i].blob).toBe(manifest.chunks[i].blob);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. v2 store+createTree+readManifest+restore round-trip
// ---------------------------------------------------------------------------
describe('CasService Merkle – v2 full round-trip', () => {
  it('stores, creates tree, reads manifest, and restores byte-identical data', async () => {
    const { service } = setup(5);

    const original = generateBuffer(7 * 1024); // 7 chunks > threshold 5
    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'roundtrip-v2',
      filename: 'roundtrip.bin',
    });

    const treeOid = await service.createTree({ manifest });
    const readBack = await service.readManifest({ treeOid });

    expect(readBack.chunks).toHaveLength(7);

    const { buffer: restored, bytesWritten } = await service.restore({ manifest: readBack });

    expect(bytesWritten).toBe(original.length);
    expect(restored.equals(original)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. v1 manifest still works with v2-capable code
// ---------------------------------------------------------------------------
describe('CasService Merkle – v1 manifest backward compatibility', () => {
  it('stores small data and performs a full round-trip without Merkle splitting', async () => {
    const { service } = setup(5);

    const original = generateBuffer(4 * 1024); // 4 chunks <= threshold 5
    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'v1-compat',
      filename: 'v1.bin',
    });

    expect(manifest.chunks).toHaveLength(4);

    const treeOid = await service.createTree({ manifest });
    const readBack = await service.readManifest({ treeOid });

    expect(readBack).toBeInstanceOf(Manifest);
    expect(readBack.chunks).toHaveLength(4);
    expect(readBack.version).toBe(1);

    const { buffer: restored } = await service.restore({ manifest: readBack });
    expect(restored.equals(original)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Sub-manifest references have correct startIndex and chunkCount
// ---------------------------------------------------------------------------
describe('CasService Merkle – sub-manifest references have correct startIndex and chunkCount', () => {
  it('verifies subManifests array entries for 12-chunk data with threshold=5', async () => {
    const { service, blobs, codec } = setup(5);

    // 12 chunks -> groups: [0..4] (5), [5..9] (5), [10..11] (2)
    const data = generateBuffer(12 * 1024);
    const manifest = await service.store({
      source: bufferSource(data),
      slug: 'sub-refs-test',
      filename: 'subrefs.bin',
    });

    expect(manifest.chunks).toHaveLength(12);

    await service.createTree({ manifest });

    const rootManifest = findLastManifestBlob(blobs, codec);
    expect(rootManifest.version).toBe(2);
    expect(rootManifest.subManifests).toHaveLength(3);

    // Group 0: chunks 0-4
    expect(rootManifest.subManifests[0].startIndex).toBe(0);
    expect(rootManifest.subManifests[0].chunkCount).toBe(5);
    expect(rootManifest.subManifests[0].oid).toBeTruthy();

    // Group 1: chunks 5-9
    expect(rootManifest.subManifests[1].startIndex).toBe(5);
    expect(rootManifest.subManifests[1].chunkCount).toBe(5);
    expect(rootManifest.subManifests[1].oid).toBeTruthy();

    // Group 2: chunks 10-11
    expect(rootManifest.subManifests[2].startIndex).toBe(10);
    expect(rootManifest.subManifests[2].chunkCount).toBe(2);
    expect(rootManifest.subManifests[2].oid).toBeTruthy();

    // Verify that sub-manifest OIDs point to actual blobs with correct chunk data
    for (const ref of rootManifest.subManifests) {
      const subBlob = blobs.get(ref.oid);
      expect(subBlob).toBeDefined();
      const subData = codec.decode(subBlob);
      expect(subData.chunks).toHaveLength(ref.chunkCount);
      // First chunk in each group should match startIndex
      expect(subData.chunks[0].index).toBe(ref.startIndex);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Exactly at threshold boundary uses v1
// ---------------------------------------------------------------------------
describe('CasService Merkle – exactly at threshold boundary uses v1', () => {
  it('stores exactly 5 chunks (= threshold) and produces a v1 manifest', async () => {
    const { service, blobs, codec } = setup(5);

    const data = generateBuffer(5 * 1024); // exactly 5 chunks
    const manifest = await service.store({
      source: bufferSource(data),
      slug: 'boundary-v1',
      filename: 'boundary.bin',
    });

    expect(manifest.chunks).toHaveLength(5);

    await service.createTree({ manifest });

    const rootManifest = findManifestBlob(blobs, codec);
    expect(rootManifest.version).toBe(1);
    expect(rootManifest.subManifests).toBeUndefined();
    expect(rootManifest.chunks).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// 8. One above threshold uses v2
// ---------------------------------------------------------------------------
describe('CasService Merkle – one above threshold uses v2', () => {
  it('stores 6 chunks (threshold + 1) and produces a v2 manifest', async () => {
    const { service, blobs, codec } = setup(5);

    const data = generateBuffer(6 * 1024); // 6 chunks
    const manifest = await service.store({
      source: bufferSource(data),
      slug: 'boundary-v2',
      filename: 'boundary-v2.bin',
    });

    expect(manifest.chunks).toHaveLength(6);

    await service.createTree({ manifest });

    const rootManifest = findLastManifestBlob(blobs, codec);
    expect(rootManifest.version).toBe(2);
    expect(rootManifest.chunks).toEqual([]);
    expect(rootManifest.subManifests).toHaveLength(2);

    // Group 0: 5 chunks, Group 1: 1 chunk
    expect(rootManifest.subManifests[0].chunkCount).toBe(5);
    expect(rootManifest.subManifests[0].startIndex).toBe(0);
    expect(rootManifest.subManifests[1].chunkCount).toBe(1);
    expect(rootManifest.subManifests[1].startIndex).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 9. v2 with encryption round-trip
// ---------------------------------------------------------------------------
describe('CasService Merkle – v2 with encryption round-trip', () => {
  it('stores encrypted data exceeding threshold, then restores byte-identical data', async () => {
    const { service } = setup(5);
    const encryptionKey = randomBytes(32);

    const original = generateBuffer(8 * 1024); // 8+ encrypted chunks (ciphertext may differ in size)
    const manifest = await service.store({
      source: bufferSource(original),
      slug: 'encrypted-merkle',
      filename: 'encrypted.bin',
      encryptionKey,
    });

    // Encrypted content should exceed threshold and trigger v2
    expect(manifest.chunks.length).toBeGreaterThan(5);
    expect(manifest.encryption).toBeDefined();
    expect(manifest.encryption.encrypted).toBe(true);

    const treeOid = await service.createTree({ manifest });
    const readBack = await service.readManifest({ treeOid });

    expect(readBack).toBeInstanceOf(Manifest);
    expect(readBack.chunks.length).toBe(manifest.chunks.length);
    expect(readBack.encryption).toBeDefined();
    expect(readBack.encryption.encrypted).toBe(true);

    const { buffer: restored } = await service.restore({
      manifest: readBack,
      encryptionKey,
    });

    expect(restored.equals(original)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. Fuzz: round-trip across various chunk counts
// ---------------------------------------------------------------------------
describe('CasService Merkle – fuzz round-trip across various chunk counts', () => {
  const chunkCounts = [1, 5, 6, 10, 25];

  for (const count of chunkCounts) {
    it(`round-trips ${count} chunk(s) correctly (${count <= 5 ? 'v1' : 'v2'})`, async () => {
      const { service, blobs, codec } = setup(5);

      const original = generateBuffer(count * 1024);
      const manifest = await service.store({
        source: bufferSource(original),
        slug: `fuzz-${count}`,
        filename: `fuzz-${count}.bin`,
      });

      expect(manifest.chunks).toHaveLength(count);

      const treeOid = await service.createTree({ manifest });

      // Verify manifest version in the blob store
      const rootManifest = findLastManifestBlob(blobs, codec);
      if (count <= 5) {
        expect(rootManifest.version).toBe(1);
        expect(rootManifest.subManifests).toBeUndefined();
        expect(rootManifest.chunks).toHaveLength(count);
      } else {
        expect(rootManifest.version).toBe(2);
        expect(rootManifest.chunks).toEqual([]);
        expect(rootManifest.subManifests).toBeDefined();
        expect(rootManifest.subManifests.length).toBe(Math.ceil(count / 5));

        // Verify total chunk count across all sub-manifests
        const totalChunks = rootManifest.subManifests.reduce((sum, ref) => sum + ref.chunkCount, 0);
        expect(totalChunks).toBe(count);
      }

      // Full round-trip: readManifest + restore
      const readBack = await service.readManifest({ treeOid });
      expect(readBack.chunks).toHaveLength(count);

      const { buffer: restored } = await service.restore({ manifest: readBack });
      expect(restored.equals(original)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Utility: find manifest blobs in the in-memory store
// ---------------------------------------------------------------------------

/**
 * Finds the first manifest-like JSON blob in the blobs Map.
 * Manifest blobs contain "slug" and "filename" fields.
 * Returns the decoded object, or undefined if not found.
 */
function findManifestBlob(blobs, codec) {
  for (const [, buf] of blobs) {
    try {
      const decoded = codec.decode(buf);
      if (decoded && typeof decoded.slug === 'string' && typeof decoded.filename === 'string') {
        return decoded;
      }
    } catch {
      // Not a JSON blob, skip
    }
  }
  return undefined;
}

/**
 * Finds the last manifest-like JSON blob in the blobs Map.
 * When Merkle splitting occurs, sub-manifests are written first and the root
 * manifest is written last, so iterating to the end yields the root.
 */
function findLastManifestBlob(blobs, codec) {
  let last;
  for (const [, buf] of blobs) {
    try {
      const decoded = codec.decode(buf);
      if (decoded && typeof decoded.slug === 'string' && typeof decoded.filename === 'string') {
        last = decoded;
      }
    } catch {
      // Not a JSON blob, skip
    }
  }
  return last;
}
