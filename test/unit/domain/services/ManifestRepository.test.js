import { describe, it, expect, vi } from 'vitest';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';
import ManifestRepository from '../../../../src/domain/services/ManifestRepository.js';
import { utf8Encode } from '../../../../src/domain/encoding/utf8.js';
import { InvalidOidError } from '../../../../src/domain/errors/index.js';

describe('ManifestRepository', () => {
  it('publishes a flat manifest tree through injected persistence', async () => {
    const writes = [];
    const repository = new ManifestRepository({
      codec: {
        extension: 'json',
        encode: (value) => utf8Encode(JSON.stringify(value)),
      },
      crypto: { sha256: vi.fn().mockResolvedValue('c'.repeat(64)) },
      legacyMode: false,
      merkleThreshold: 10,
      persistence: {
        writeBlob: vi.fn(async (bytes) => {
          writes.push(bytes);
          return `${writes.length}`.repeat(40);
        }),
        writeTree: vi.fn().mockResolvedValue('d'.repeat(40)),
      },
    });
    const manifest = new Manifest({ slug: 'asset', filename: 'a.bin', size: 0, chunks: [] });

    await expect(repository.createTree({ manifest })).resolves.toBe('d'.repeat(40));
    expect(writes).toHaveLength(1);
  });

  it('rejects invalid tree OIDs before reading persistence', async () => {
    const persistence = {
      readTree: vi.fn(),
    };
    const repository = new ManifestRepository({
      codec: {},
      crypto: {},
      legacyMode: false,
      merkleThreshold: 10,
      persistence,
    });

    await expect(repository.readManifest({ treeOid: 'not-an-oid' }))
      .rejects.toBeInstanceOf(InvalidOidError);
    expect(persistence.readTree).not.toHaveBeenCalled();
  });
});

describe('ManifestRepository batch persistence', () => {
  it('falls back to singleton persistence when optional batch writes are absent', async () => {
    const writeBlob = vi.fn()
      .mockResolvedValueOnce('1'.repeat(40))
      .mockResolvedValueOnce('2'.repeat(40));
    const writeTree = vi.fn()
      .mockResolvedValueOnce('3'.repeat(40))
      .mockResolvedValueOnce('4'.repeat(40));
    const repository = new ManifestRepository({
      codec: {
        extension: 'json',
        encode: (value) => utf8Encode(JSON.stringify(value)),
      },
      crypto: { sha256: vi.fn().mockResolvedValue('c'.repeat(64)) },
      legacyMode: false,
      merkleThreshold: 10,
      persistence: { writeBlob, writeTree },
    });
    const manifests = ['a.bin', 'b.bin'].map((filename) => new Manifest({
      slug: filename,
      filename,
      size: 0,
      chunks: [],
    }));

    await expect(repository.createTrees(manifests.map((manifest) => ({ manifest }))))
      .resolves.toEqual(['3'.repeat(40), '4'.repeat(40)]);
    expect(writeBlob).toHaveBeenCalledTimes(2);
    expect(writeTree).toHaveBeenCalledTimes(2);
  });
});
