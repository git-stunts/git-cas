import { describe, it, expect, vi } from 'vitest';
import {
  buildVaultStats,
  inspectVaultHealth,
  renderDoctorReport,
  renderVaultStats,
} from '../../../bin/ui/vault-report.js';

function makeManifest(data) {
  return {
    ...data,
    toJSON() {
      return data;
    },
  };
}

function makeSampleRecords() {
  return [
    {
      slug: 'photos/hero.jpg',
      treeOid: 'tree-1',
      manifest: makeManifest({
        slug: 'photos/hero.jpg',
        size: 1000,
        chunks: [
          { blob: 'blob-1', size: 600 },
          { blob: 'blob-2', size: 400 },
        ],
        encryption: { encrypted: true },
        compression: { algorithm: 'gzip' },
        chunking: { strategy: 'fixed', params: {} },
      }),
    },
    {
      slug: 'photos/thumb.jpg',
      treeOid: 'tree-2',
      manifest: makeManifest({
        slug: 'photos/thumb.jpg',
        size: 600,
        chunks: [
          { blob: 'blob-2', size: 400 },
          { blob: 'blob-3', size: 200 },
        ],
        encryption: {
          encrypted: true,
          recipients: [{ label: 'alice', wrappedDek: 'x', nonce: 'y', tag: 'z' }],
        },
        chunking: { strategy: 'cdc', params: {} },
      }),
    },
  ];
}

function makePartialFailureCas() {
  return {
    getVaultService: vi.fn().mockResolvedValue({
      readState: vi.fn().mockResolvedValue({
        entries: new Map([
          ['ok/asset', 'tree-1'],
          ['bad/asset', 'tree-2'],
        ]),
        parentCommitOid: 'commit-1',
        metadata: { version: 1 },
      }),
    }),
    readManifest: vi.fn(async ({ treeOid }) => {
      if (treeOid === 'tree-2') {
        const error = new Error('manifest missing');
        error.code = 'MANIFEST_NOT_FOUND';
        throw error;
      }

      return makeManifest({
        slug: 'ok/asset',
        size: 512,
        chunks: [{ blob: 'blob-1', size: 512 }],
        chunking: { strategy: 'fixed', params: {} },
      });
    }),
  };
}

describe('buildVaultStats', () => {
  it('aggregates logical size, dedupe, encryption, and chunking data', () => {
    const stats = buildVaultStats(makeSampleRecords());

    expect(stats).toMatchObject({
      entries: 2,
      totalLogicalSize: 1600,
      totalChunkRefs: 4,
      uniqueChunks: 3,
      duplicateChunkRefs: 1,
      encryptedEntries: 2,
      envelopeEntries: 1,
      compressedEntries: 1,
      chunkingStrategies: { fixed: 1, cdc: 1 },
      largestEntry: { slug: 'photos/hero.jpg', size: 1000 },
    });
    expect(stats.dedupRatio).toBeCloseTo(4 / 3, 6);
  });
});

describe('renderVaultStats', () => {
  it('renders a concise operator-facing report', () => {
    const output = renderVaultStats({
      entries: 2,
      totalLogicalSize: 1600,
      totalChunkRefs: 4,
      uniqueChunks: 3,
      duplicateChunkRefs: 1,
      dedupRatio: 4 / 3,
      encryptedEntries: 2,
      envelopeEntries: 1,
      compressedEntries: 1,
      chunkingStrategies: { fixed: 1, cdc: 1 },
      largestEntry: { slug: 'photos/hero.jpg', size: 1000 },
    });

    expect(output).toMatch(/entries\s+2/);
    expect(output).toMatch(/logical-size\s+1\.6 KiB \(1600 bytes\)/);
    expect(output).toMatch(/dedup-ratio\s+1\.33x/);
    expect(output).toMatch(/chunking\s+cdc:1, fixed:1/);
    expect(output).toMatch(/largest\s+photos\/hero\.jpg \(1000 bytes\)/);
    expect(output).not.toContain('\t');
  });
});

describe('inspectVaultHealth', () => {
  it('returns a warning when refs/cas/vault is missing', async () => {
    const cas = {
      getVaultService: vi.fn().mockResolvedValue({
        readState: vi.fn().mockResolvedValue({
          entries: new Map(),
          parentCommitOid: null,
          metadata: null,
        }),
      }),
    };

    const report = await inspectVaultHealth(cas);

    expect(report.status).toBe('warn');
    expect(report.hasVault).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'VAULT_REF_MISSING',
        scope: 'vault',
      }),
    ]);
  });

  it('records per-entry manifest failures without aborting the scan', async () => {
    const cas = makePartialFailureCas();

    const report = await inspectVaultHealth(cas);

    expect(report.status).toBe('fail');
    expect(report.hasVault).toBe(true);
    expect(report.entryCount).toBe(2);
    expect(report.validEntries).toBe(1);
    expect(report.invalidEntries).toBe(1);
    expect(report.stats).toMatchObject({
      entries: 1,
      totalChunkRefs: 1,
      uniqueChunks: 1,
    });
    expect(report.issues).toEqual([
      expect.objectContaining({
        scope: 'entry',
        slug: 'bad/asset',
        treeOid: 'tree-2',
        code: 'MANIFEST_NOT_FOUND',
        message: 'manifest missing',
      }),
    ]);
  });
});

describe('renderDoctorReport', () => {
  it('renders health summary and issues', () => {
    const output = renderDoctorReport({
      status: 'fail',
      hasVault: true,
      commitOid: 'commit-1',
      entryCount: 2,
      checkedEntries: 2,
      validEntries: 1,
      invalidEntries: 1,
      metadataEncrypted: false,
      stats: {
        entries: 1,
        totalLogicalSize: 512,
        totalChunkRefs: 1,
        uniqueChunks: 1,
        duplicateChunkRefs: 0,
        dedupRatio: 1,
        encryptedEntries: 0,
        envelopeEntries: 0,
        compressedEntries: 0,
        chunkingStrategies: { fixed: 1 },
        largestEntry: { slug: 'ok/asset', size: 512 },
      },
      issues: [
        {
          scope: 'entry',
          slug: 'bad/asset',
          treeOid: 'tree-2',
          code: 'MANIFEST_NOT_FOUND',
          message: 'manifest missing',
        },
      ],
    });

    expect(output).toMatch(/status\s+fail/);
    expect(output).toMatch(/vault\s+present/);
    expect(output).toMatch(/issues\s+1/);
    expect(output).toContain('[entry] bad/asset (tree-2) MANIFEST_NOT_FOUND: manifest missing');
    expect(output).not.toContain('\t');
  });
});
