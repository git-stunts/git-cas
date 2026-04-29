import { describe, it, expect, vi } from 'vitest';
import { makeCtx } from './_testContext.js';
import { renderRepoTreemapMap, renderRepoTreemapSidebar } from '../../../bin/ui/repo-treemap.js';

vi.mock('../../../bin/ui/context.js', () => ({
  getCliContext: () => makeCtx(),
}));

describe('repo treemap map rendering', () => {
  it('renders multiple large regions with correct borders', () => {
    const ctx = makeCtx();
    const output = renderRepoTreemapMap({
      breadcrumb: ['root'],
      tiles: [
        { id: 'a', label: 'a', value: 100, kind: 'worktree' },
        { id: 'b', label: 'b', value: 100, kind: 'worktree' },
      ],
      totalValue: 200,
    }, { ctx, width: 40, height: 20 });

    // Verify box-drawing characters are present for the layout
    expect(output).toContain('┌');
    expect(output).toContain('┐');
    expect(output).toContain('│');
    // Verify labels are centered in tiles
    expect(output).toContain('a');
    expect(output).toContain('b');
  });

  it('renders label text correctly', () => {
    const ctx = makeCtx();
    const output = renderRepoTreemapMap({
      breadcrumb: ['root'],
      tiles: [{ id: 'docs', label: 'docs', value: 100, kind: 'worktree' }],
      totalValue: 100,
    }, { ctx, width: 40, height: 20 });

    expect(output).toContain('docs');
  });
});

describe('repo treemap sidebar basics', () => {
  it('renders breadcrumb path', () => {
    const ctx = makeCtx();
    const sidebar = renderRepoTreemapSidebar({
      scope: 'repository',
      source: { type: 'vault' },
      breadcrumb: ['root', 'src', 'core'],
      cwd: '/test',
      tiles: [],
      notes: [],
      totalValue: 1000,
      summary: { vaultEntries: 1, sourceEntries: 1 },
    }, { ctx, width: 40, height: 24 });

    expect(sidebar.overview).toContain('root > src > core');
  });

  it('renders logical source weighting for source scope', () => {
    const ctx = makeCtx();
    const sidebar = renderRepoTreemapSidebar({
      scope: 'source',
      source: { type: 'vault' },
      breadcrumb: ['root'],
      cwd: '/test',
      tiles: [],
      notes: [],
      totalValue: 1000,
      summary: { vaultEntries: 1, sourceEntries: 1 },
    }, { ctx, width: 40, height: 24 });

    expect(sidebar.overview).toContain('logical source weighting');
  });
});

describe('repo treemap sidebar focus', () => {
  it('renders tile details for the focused region', () => {
    const ctx = makeCtx();
    const sidebar = renderRepoTreemapSidebar({
      scope: 'repository',
      source: { type: 'vault' },
      breadcrumb: ['root'],
      cwd: '/test',
      tiles: [{ id: 'a', label: 'test-region', value: 500, detail: '500 bytes', kind: 'worktree', drillable: true }],
      notes: [],
      totalValue: 1000,
      summary: { vaultEntries: 1, sourceEntries: 1 },
    }, { ctx, width: 40, height: 24, selectedTileId: 'a' });

    expect(sidebar.focused).toContain('test-region');
    expect(sidebar.focused).toContain('worktree · 50.0%');
    expect(sidebar.focused).toContain('Press + to descend');
  });
});
