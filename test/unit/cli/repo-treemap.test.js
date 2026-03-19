import { describe, it, expect } from 'vitest';
import { renderRepoTreemapMap, renderRepoTreemapSidebar } from '../../../bin/ui/repo-treemap.js';
import { makeCtx } from './_testContext.js';

function makeReport(overrides = {}) {
  return {
    scope: 'repository',
    worktreeMode: 'tracked',
    cwd: '/tmp/git-cas-fixture',
    source: { type: 'vault' },
    totalValue: 21_400_000,
    tiles: [
      { label: 'docs', kind: 'worktree', value: 3_638_000, detail: '33 tracked paths · 3.5M on disk' },
      { label: 'public', kind: 'worktree', value: 107_000, detail: '5 tracked paths · 104.5K on disk' },
      { label: 'package-lock.json', kind: 'worktree', value: 107_000, detail: '1 tracked path · 104.5K on disk' },
      { label: 'test', kind: 'worktree', value: 64_000, detail: '17 tracked paths · 62.5K on disk' },
      { label: 'pnpm-lock.yaml', kind: 'worktree', value: 64_000, detail: '1 tracked path · 62.5K on disk' },
      { label: 'src', kind: 'worktree', value: 43_000, detail: '6 tracked paths · 42.0K on disk' },
      { label: 'scripts', kind: 'worktree', value: 21_000, detail: '13 tracked paths · 20.5K on disk' },
      { label: '.git/objects', kind: 'git', value: 8_000_000, detail: '7.6M on disk' },
      { label: 'refs/git-cms', kind: 'ref', value: 2_000_000, detail: '17 refs' },
      { label: 'vault', kind: 'vault', value: 1_500_000, detail: '2 entries · 1.4M logical' },
    ],
    notes: [
      'Repository view mixes Git-reported worktree paths, .git on-disk bytes, and logical CAS region sizes.',
    ],
    summary: {
      bare: false,
      gitDir: '/tmp/git-cas-fixture/.git',
      worktreeItems: 7,
      worktreePaths: 102,
      refNamespaces: 1,
      refCount: 17,
      vaultEntries: 2,
      sourceEntries: 0,
    },
    ...overrides,
  };
}

function makeStyledCtx() {
  return /** @type {any} */ ({
    style: {
      rgb: (...args) => {
        const [red, green, blue, text] = args;
        return `[fg:${red},${green},${blue}]${text}[/fg]`;
      },
      bgRgb: (...args) => `[bg]${args[3]}[/bg]`,
      bold: (text) => `[bold]${text}[/bold]`,
    },
  });
}

describe('repo treemap map rendering', () => {
  it('renders multiple large regions when the half-split crosses on the last item', () => {
    const output = renderRepoTreemapMap(makeReport(), {
      ctx: makeCtx(),
      width: 120,
      height: 28,
    });

    expect(output).toContain('docs');
    expect(output).toContain('.git/objects');
    expect(output).toContain('refs/git-cms');
  });

  it('renders label text as bold white without painting stripe backgrounds', () => {
    const output = renderRepoTreemapMap(makeReport({
      totalValue: 10,
      tiles: [{ label: 'docs', kind: 'worktree', value: 10, detail: '10 tracked paths' }],
    }), {
      ctx: makeStyledCtx(),
      width: 24,
      height: 8,
    });

    expect(output).toContain('[bold][fg:255,255,255]d[/fg][/bold]');
    expect(output).toContain('[bold][fg:255,255,255]o[/fg][/bold]');
    expect(output).not.toContain('[bg]');
  });
});

describe('repo treemap sidebar rendering', () => {

  it('sorts sidebar largest regions by value instead of source construction order', () => {
    const sidebar = renderRepoTreemapSidebar(makeReport(), {
      ctx: makeCtx(),
      width: 60,
      height: 28,
    });
    const regionLines = sidebar.regions.split('\n');

    expect(regionLines[0]).toContain('.git/objects');
    expect(regionLines[1]).toContain('docs');
    expect(regionLines[2]).toContain('refs/git-cms');
  });

  it('wraps notes on whitespace before falling back to hard character breaks', () => {
    const sidebar = renderRepoTreemapSidebar(makeReport({
      notes: ['alpha beta longword delta', 'supercalifragilistic'],
    }), {
      ctx: makeCtx(),
      width: 16,
      height: 32,
    });

    expect(sidebar.notes.split('\n')).toEqual([
      'alpha beta',
      'longword delta',
      'supercalifragili',
      'stic',
    ]);
  });
});
