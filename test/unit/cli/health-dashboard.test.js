import { describe, expect, it } from 'vitest';
import { makeCtx } from './_testContext.js';
import { renderHealthMetrics } from '../../../bin/ui/blocks/health-dashboard.js';

function makeDoctorReport() {
  return {
    status: 'ok',
    hasVault: true,
    commitOid: 'commit-1',
    entryCount: 2,
    checkedEntries: 2,
    validEntries: 2,
    invalidEntries: 0,
    metadataEncrypted: false,
    stats: {
      entries: 2,
      totalLogicalSize: 1600,
      totalChunkRefs: 4,
      totalChunkBytes: 1600,
      uniqueChunks: 3,
      duplicateChunkRefs: 1,
      uniqueChunkBytes: 1200,
      duplicateChunkBytes: 400,
      dedupRatio: 4 / 3,
      byteDedupRatio: 4 / 3,
    },
    issues: [],
  };
}

describe('renderHealthMetrics', () => {
  it('renders byte-level dedupe metrics from doctor stats', () => {
    const output = renderHealthMetrics(makeDoctorReport(), makeCtx());

    expect(output).toContain('chunk bytes');
    expect(output).toContain('1.6 KiB');
    expect(output).toContain('unique chunk bytes');
    expect(output).toContain('1.2 KiB');
    expect(output).toContain('duplicate chunk bytes');
    expect(output).toContain('400 bytes');
    expect(output).toContain('byte dedup ratio');
    expect(output).toContain('1.33x');
  });
});
