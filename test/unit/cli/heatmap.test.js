import { describe, it, expect, vi } from 'vitest';
import { makeCtx } from './_testContext.js';

vi.mock('../../../bin/ui/context.js', () => ({
  getCliContext: () => makeCtx(),
}));

const { renderHeatmap } = await import('../../../bin/ui/heatmap.js');

function makeManifest(chunkCount, subManifests) {
  const chunks = Array.from({ length: chunkCount }, (_, i) => ({
    index: i, size: 262144, digest: 'a'.repeat(64), blob: 'b'.repeat(40),
  }));
  const m = { toJSON() { return this; }, version: 1, slug: 'test', filename: 'test.bin', size: chunkCount * 262144, chunks };
  if (subManifests) {
    m.subManifests = subManifests;
    m.version = 2;
  }
  return m;
}

describe('renderHeatmap', () => {
  it('shows "No chunks" for empty manifest', () => {
    expect(renderHeatmap({ manifest: makeManifest(0) })).toBe('No chunks to display\n');
  });

  it('renders blocks for each chunk', () => {
    const output = renderHeatmap({ manifest: makeManifest(5) });
    const blocks = (output.match(/\u2588/g) || []).length;
    expect(blocks).toBe(5);
  });

  it('renders legend with chunk count', () => {
    const output = renderHeatmap({ manifest: makeManifest(10) });
    expect(output).toContain('10 chunks');
    expect(output).toContain('256.0 KiB/chunk');
  });

  it('renders sub-manifest info in legend', () => {
    const subs = [
      { oid: 'aaa', chunkCount: 5, startIndex: 0 },
      { oid: 'bbb', chunkCount: 5, startIndex: 5 },
    ];
    const output = renderHeatmap({ manifest: makeManifest(10, subs) });
    expect(output).toContain('2 sub-manifests');
  });

  it('single chunk renders correctly', () => {
    const output = renderHeatmap({ manifest: makeManifest(1) });
    const blocks = (output.match(/\u2588/g) || []).length;
    expect(blocks).toBe(1);
  });
});
