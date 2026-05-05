import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildChunkTreeEntries,
  buildFlatManifestTreeEntries,
  buildMerkleTreeEntries,
  buildSubManifestTreeEntries,
  formatBlobTreeEntry,
} from '../../../../src/domain/services/GitTreeBuilder.js';

const repoRoot = process.cwd();

describe('GitTreeBuilder', () => {
  it('formats blob tree entries in one place', () => {
    expect(formatBlobTreeEntry({ oid: 'a'.repeat(40), name: 'manifest.json' }))
      .toBe(`100644 blob ${'a'.repeat(40)}\tmanifest.json`);
  });

  it('builds first-seen unique chunk entries', () => {
    const chunks = [
      { digest: 'sha256:one', blob: '1'.repeat(40) },
      { digest: 'sha256:two', blob: '2'.repeat(40) },
      { digest: 'sha256:one', blob: '1'.repeat(40) },
    ];

    expect(buildChunkTreeEntries(chunks)).toEqual([
      `100644 blob ${'1'.repeat(40)}\tsha256:one`,
      `100644 blob ${'2'.repeat(40)}\tsha256:two`,
    ]);
  });
});

describe('GitTreeBuilder manifest layouts', () => {
  it('builds flat manifest and Merkle tree entries', () => {
    const chunks = [{ digest: 'sha256:one', blob: '1'.repeat(40) }];
    const subManifests = [
      { oid: '2'.repeat(40), chunkCount: 1000, startIndex: 0 },
      { oid: '3'.repeat(40), chunkCount: 500, startIndex: 1000 },
    ];

    expect(buildFlatManifestTreeEntries({
      manifestOid: 'a'.repeat(40),
      chunks,
      extension: 'json',
    })).toEqual([
      `100644 blob ${'a'.repeat(40)}\tmanifest.json`,
      `100644 blob ${'1'.repeat(40)}\tsha256:one`,
    ]);
    expect(buildSubManifestTreeEntries({ subManifests, extension: 'json' })).toEqual([
      `100644 blob ${'2'.repeat(40)}\tsub-manifest-0.json`,
      `100644 blob ${'3'.repeat(40)}\tsub-manifest-1.json`,
    ]);
    expect(buildMerkleTreeEntries({
      rootManifestOid: 'b'.repeat(40),
      subManifests,
      chunks,
      extension: 'json',
    })).toEqual([
      `100644 blob ${'b'.repeat(40)}\tmanifest.json`,
      `100644 blob ${'2'.repeat(40)}\tsub-manifest-0.json`,
      `100644 blob ${'3'.repeat(40)}\tsub-manifest-1.json`,
      `100644 blob ${'1'.repeat(40)}\tsha256:one`,
    ]);
  });
});

describe('CasService tree-entry boundary', () => {
  it('does not own raw Git tree-entry formatting strings', () => {
    const casService = readFileSync(path.join(repoRoot, 'src/domain/services/CasService.js'), 'utf8');

    expect(casService).not.toContain('100644 blob');
  });
});
