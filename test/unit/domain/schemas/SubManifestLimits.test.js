import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { ManifestSchema } from '../../../../src/domain/schemas/ManifestSchema.js';

const sha1 = (str) => createHash('sha1').update(str).digest('hex');

function validManifest(subManifestCount) {
  return {
    version: 2,
    slug: 'test',
    filename: 'test.bin',
    size: 0,
    chunks: [],
    subManifests: Array.from({ length: subManifestCount }, (_, i) => ({
      oid: sha1(`sub-${i}`),
      chunkCount: 10,
      startIndex: i * 10,
    })),
  };
}

describe('ManifestSchema – subManifests array limit', () => {
  it('accepts a manifest with a reasonable number of sub-manifests', () => {
    expect(() => ManifestSchema.parse(validManifest(100))).not.toThrow();
  });

  it('rejects a manifest with an excessive number of sub-manifests', () => {
    expect(() => ManifestSchema.parse(validManifest(10_001))).toThrow(/too_big|array|maximum/i);
  });
});
