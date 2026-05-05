import { describe, it, expect, vi } from 'vitest';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';
import ManifestRepository from '../../../../src/domain/services/ManifestRepository.js';
import { utf8Encode } from '../../../../src/domain/encoding/utf8.js';

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
});
