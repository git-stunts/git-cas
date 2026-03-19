import { describe, it, expect, vi } from 'vitest';
import { surfaceToString } from '@flyingrobots/bijou';
import { createNavigableTableState, createSplitPaneState } from '@flyingrobots/bijou-tui';
import { makeCtx } from './_testContext.js';

vi.mock('../../../bin/ui/context.js', () => ({
  getCliContext: () => makeCtx(),
  createCliTuiContext: () => makeCtx(),
}));

const { createDashboardApp, createKeyBindings } = await import('../../../bin/ui/dashboard.js');

function mockCas() {
  return {
    listVault: vi.fn().mockResolvedValue([]),
    getVaultMetadata: vi.fn().mockResolvedValue(null),
    readManifest: vi.fn().mockResolvedValue(null),
  };
}

function makeDeps(overrides = {}) {
  return {
    keyMap: createKeyBindings(),
    cas: mockCas(),
    ctx: makeCtx(),
    cwdLabel: '/tmp/git-cas-fixture',
    source: { type: 'vault' },
    ...overrides,
  };
}

function renderView(output, ctx) {
  return typeof output === 'string' ? output : surfaceToString(output, ctx.style);
}

function buildTableRows(entries, manifestCache = new Map()) {
  return entries.map((entry) => {
    const manifest = manifestCache.get(entry.slug);
    if (!manifest) {
      return [entry.slug, '...', '...', '...', '...', 'loading'];
    }
    const m = manifest.toJSON ? manifest.toJSON() : manifest;
    return [
      entry.slug,
      String(m.size ?? 0),
      String(m.chunks?.length ?? 0),
      m.encryption ? 'enc' : 'plain',
      m.compression ? m.compression.algorithm : 'raw',
      m.subManifests?.length ? 'merkle' : 'single',
    ];
  });
}

function makeTable(filtered = [], options = {}) {
  const rows = options.rows || 24;
  const manifestCache = options.manifestCache || new Map();
  return {
    ...createNavigableTableState({
      columns: [{ header: 'Slug', width: 20 }],
      rows: buildTableRows(filtered, manifestCache),
      height: Math.max(1, rows - 12),
    }),
    ...(options.overrides || {}),
  };
}

function makeRefsTable(items = [], rows = 24, overrides = {}) {
  return {
    ...createNavigableTableState({
      columns: [{ header: 'Ref', width: 32 }],
      rows: items.map((item) => [item.ref, item.resolution, String(item.entryCount)]),
      height: Math.max(1, rows - 12),
    }),
    ...overrides,
  };
}

function makeModel(overrides = {}) {
  const manifestCache = overrides.manifestCache || new Map();
  const filtered = overrides.filtered || overrides.entries || [];
  const rows = overrides.rows || 24;
  const refsItems = overrides.refsItems || [];
  return {
    status: 'ready',
    columns: 80,
    rows: 24,
    source: { type: 'vault' },
    entries: [],
    filtered: [],
    filterText: '',
    filtering: false,
    metadata: null,
    manifestCache,
    loadingSlug: null,
    detailScroll: 0,
    error: null,
    table: makeTable(filtered, { rows, manifestCache }),
    refsTable: makeRefsTable(refsItems, rows),
    refsItems,
    splitPane: createSplitPaneState({ ratio: 0.37, focused: 'a' }),
    palette: null,
    activeDrawer: null,
    refsStatus: 'idle',
    refsError: null,
    statsStatus: 'idle',
    statsReport: null,
    statsError: null,
    doctorStatus: 'idle',
    doctorReport: null,
    doctorError: null,
    treemapScope: 'repository',
    treemapWorktreeMode: 'tracked',
    treemapPath: [],
    treemapFocus: 0,
    treemapStatus: 'idle',
    treemapReport: null,
    treemapError: null,
    toasts: [],
    nextToastId: 1,
    ...overrides,
  };
}

function keyMsg(key, opts = {}) {
  return { type: 'key', key, ctrl: false, alt: false, shift: false, ...opts };
}

const entries = [
  { slug: 'alpha', treeOid: 'aaa111' },
  { slug: 'bravo', treeOid: 'bbb222' },
];

function makeStatsReport() {
  return {
    entries: 2,
    totalLogicalSize: 4096,
    totalChunkRefs: 3,
    uniqueChunks: 2,
    duplicateChunkRefs: 1,
    dedupRatio: 1.5,
    encryptedEntries: 1,
    envelopeEntries: 0,
    compressedEntries: 1,
    chunkingStrategies: { fixed: 2 },
    largestEntry: { slug: 'alpha', size: 2048 },
  };
}

function makeDoctorReport() {
  return {
    status: 'warn',
    hasVault: true,
    commitOid: 'abc123',
    entryCount: 2,
    checkedEntries: 2,
    validEntries: 1,
    invalidEntries: 1,
    metadataEncrypted: false,
    stats: makeStatsReport(),
    issues: [{ scope: 'vault', code: 'BROKEN', message: 'bad chunk' }],
  };
}

function makeRefItems() {
  return [
    {
      ref: 'refs/warp/demo/seek-cache',
      oid: '2222222222222222222222222222222222222222',
      namespace: 'refs/warp',
      browsable: true,
      resolution: 'index',
      entryCount: 2,
      detail: '2 CAS entries from index blob',
      previewSlugs: ['alpha', 'bravo'],
      source: { type: 'ref', ref: 'refs/warp/demo/seek-cache' },
    },
    {
      ref: 'refs/heads/main',
      oid: '1111111111111111111111111111111111111111',
      namespace: 'refs/heads',
      browsable: false,
      resolution: 'opaque',
      entryCount: 0,
      detail: 'does not resolve to CAS entries',
      previewSlugs: [],
      source: null,
    },
  ];
}

function makeTreemapTile(options) {
  const {
    kind,
    label,
    value,
    detail,
    drillable = true,
    segments = [label],
    id = `${kind}:${segments.join(':')}`,
  } = options;
  return {
    id,
    label,
    kind,
    value,
    detail,
    drillable,
    path: drillable && segments ? { kind, segments, label } : null,
  };
}

function makeTreemapSummary(overrides = {}) {
  return {
    bare: false,
    gitDir: '/tmp/git-cas-fixture/.git',
    worktreeItems: 1,
    worktreePaths: 2,
    refNamespaces: 1,
    refCount: 3,
    vaultEntries: 2,
    sourceEntries: 2,
    ...overrides,
  };
}

function makeTreemapReport(overrides = {}) {
  return {
    scope: 'repository',
    worktreeMode: 'tracked',
    cwd: '/tmp/git-cas-fixture',
    source: { type: 'vault' },
    drillPath: [],
    breadcrumb: ['repository'],
    totalValue: 8192,
    tiles: [
      makeTreemapTile({ kind: 'worktree', label: 'src', value: 4096, detail: '2 tracked paths · 4.0K on disk' }),
      makeTreemapTile({ kind: 'git', label: '.git/objects', value: 2048, detail: '2 git items · 2.0K on disk',
        segments: ['.git/objects'],
      }),
      makeTreemapTile({ kind: 'vault', label: 'docs', value: 2048, detail: '2 entries · 2.0K logical' }),
    ],
    notes: [
      'Repository view mixes Git-reported worktree paths, .git on-disk bytes, ref namespaces, and logical CAS region sizes.',
      'Worktree mode tracked via git ls-files.',
    ],
    summary: makeTreemapSummary(),
    ...overrides,
  };
}

function renderDashboardWithModel(modelOverrides = {}, depsOverrides = {}) {
  const deps = makeDeps(depsOverrides);
  const app = createDashboardApp(deps);
  return {
    deps,
    app,
    rendered: renderView(app.view(makeModel(modelOverrides)), deps.ctx),
  };
}

function makeFullScreenTreemapModel() {
  return {
    activeDrawer: 'treemap',
    treemapScope: 'repository',
    treemapStatus: 'ready',
    treemapReport: makeTreemapReport({
      tiles: [
        makeTreemapTile({ kind: 'worktree', label: 'src', value: 4096, detail: '2 tracked paths · 4.0K on disk' }),
        makeTreemapTile({ kind: 'git', label: '.git/objects', value: 2048, detail: '2 git items · 2.0K on disk',
          segments: ['.git/objects'],
        }),
        makeTreemapTile({ kind: 'meta', label: 'other', value: 1024, detail: '2 smaller regions',
          id: 'meta:other',
          drillable: false,
          segments: null,
        }),
      ],
    }),
    columns: 120,
    rows: 36,
  };
}

describe('dashboard initialization', () => {
  it('init returns loading model with one cmd', () => {
    const app = createDashboardApp(makeDeps());
    const [model, cmds] = app.init();
    expect(model.status).toBe('loading');
    expect(cmds).toHaveLength(1);
    expect(model.splitPane.focused).toBe('a');
  });
});

describe('dashboard navigation', () => {
  it('move table focus down', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({ filtered: entries, entries });
    const [next] = app.update(keyMsg('j'), model);
    expect(next.table.focusRow).toBe(1);
  });

  it('move table focus up wraps to the last row', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({ filtered: entries, entries });
    const [next] = app.update(keyMsg('k'), model);
    expect(next.table.focusRow).toBe(1);
  });

  it('pages table focus down', () => {
    const app = createDashboardApp(makeDeps());
    const manyEntries = Array.from({ length: 20 }, (_, index) => ({ slug: `asset-${index}`, treeOid: `oid-${index}` }));
    const model = makeModel({ filtered: manyEntries, entries: manyEntries });
    const [next] = app.update(keyMsg('d'), model);
    expect(next.table.focusRow).toBeGreaterThan(0);
  });

  it('quit returns quit command', () => {
    const app = createDashboardApp(makeDeps());
    const [, cmds] = app.update(keyMsg('q'), makeModel());
    expect(cmds).toHaveLength(1);
  });

  it('scroll-detail adjusts offset', () => {
    const app = createDashboardApp(makeDeps());
    const [next] = app.update(keyMsg('j', { shift: true }), makeModel());
    expect(next.detailScroll).toBe(3);
  });
});

describe('dashboard pane controls', () => {
  it('resize updates dimensions', () => {
    const app = createDashboardApp(makeDeps());
    const [next] = app.update({ type: 'resize', columns: 120, rows: 40 }, makeModel());
    expect(next.columns).toBe(120);
    expect(next.rows).toBe(40);
    expect(next.table.height).toBe(28);
  });

  it('tab toggles the focused pane', () => {
    const app = createDashboardApp(makeDeps());
    const [next] = app.update(keyMsg('tab'), makeModel());
    expect(next.splitPane.focused).toBe('b');
  });

  it('shift+l widens the focused pane', () => {
    const app = createDashboardApp(makeDeps());
    const [next] = app.update(keyMsg('l', { shift: true }), makeModel());
    expect(next.splitPane.ratio).toBeGreaterThan(0.37);
  });
});

describe('dashboard palette and overlay commands', () => {
  it('ctrl+p opens the command palette', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const [next] = app.update(keyMsg('p', { ctrl: true }), makeModel());
    expect(next.palette).not.toBeNull();
    const rendered = renderView(app.view(next), deps.ctx);
    expect(rendered).toContain('Command Palette');
    expect(rendered).toContain('Open Repo Treemap');
    expect(rendered).toContain('Open Source Stats');
  });

  it('palette selection opens the stats drawer and queues a load', () => {
    const app = createDashboardApp(makeDeps());
    const [withPalette] = app.update(keyMsg('p', { ctrl: true }), makeModel());
    const [onTreemap] = app.update(keyMsg('down'), withPalette);
    const [onTreemapScope] = app.update(keyMsg('down'), onTreemap);
    const [onTreemapWorktree] = app.update(keyMsg('down'), onTreemapScope);
    const [onTreemapDrillIn] = app.update(keyMsg('down'), onTreemapWorktree);
    const [onTreemapDrillOut] = app.update(keyMsg('down'), onTreemapDrillIn);
    const [onStats] = app.update(keyMsg('down'), onTreemapDrillOut);
    const [next, cmds] = app.update(keyMsg('enter'), onStats);
    expect(next.palette).toBeNull();
    expect(next.activeDrawer).toBe('stats');
    expect(next.statsStatus).toBe('loading');
    expect(cmds).toHaveLength(1);
  });
});

describe('dashboard drawer shortcuts', () => {
  it('doctor key opens the doctor drawer and queues a load', () => {
    const app = createDashboardApp(makeDeps());
    const [next, cmds] = app.update(keyMsg('g'), makeModel());
    expect(next.activeDrawer).toBe('doctor');
    expect(next.doctorStatus).toBe('loading');
    expect(cmds).toHaveLength(1);
  });

  it('escape closes the active overlay', () => {
    const app = createDashboardApp(makeDeps());
    const [next] = app.update(keyMsg('escape'), makeModel({ activeDrawer: 'stats', statsStatus: 'ready' }));
    expect(next.activeDrawer).toBeNull();
  });
});

describe('dashboard toast dismissal', () => {
  it('escape dismisses the latest toast when no overlay is open', () => {
    const app = createDashboardApp(makeDeps());
    const [next] = app.update(keyMsg('escape'), makeModel({
      toasts: [
        { id: 2, level: 'warning', title: 'Heads up', message: 'yellow alert' },
        { id: 1, level: 'error', title: 'Failed to load repo treemap', message: 'boom' },
      ],
    }));
    expect(next.toasts).toEqual([
      { id: 1, level: 'error', title: 'Failed to load repo treemap', message: 'boom' },
    ]);
  });
});

describe('dashboard treemap launch shortcuts', () => {
  it('t opens the treemap view and queues a load', () => {
    const app = createDashboardApp(makeDeps());
    const [next, cmds] = app.update(keyMsg('t'), makeModel());
    expect(next.activeDrawer).toBe('treemap');
    expect(next.treemapStatus).toBe('loading');
    expect(cmds).toHaveLength(1);
  });
});

describe('dashboard treemap view shortcuts', () => {
  it('shift+t toggles the treemap scope and triggers a load', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({
      activeDrawer: 'treemap',
      treemapScope: 'repository',
      treemapStatus: 'ready',
      treemapReport: { scope: 'repository' },
    });
    const [next, cmds] = app.update(keyMsg('t', { shift: true }), model);
    expect(next.treemapScope).toBe('source');
    expect(next.activeDrawer).toBe('treemap');
    expect(next.treemapStatus).toBe('loading');
    expect(cmds).toHaveLength(1);
  });

  it('i toggles repository treemap files between tracked and ignored', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({
      activeDrawer: 'treemap',
      treemapScope: 'repository',
      treemapWorktreeMode: 'tracked',
      treemapStatus: 'ready',
      treemapReport: makeTreemapReport(),
    });
    const [next, cmds] = app.update(keyMsg('i'), model);
    expect(next.treemapScope).toBe('repository');
    expect(next.treemapWorktreeMode).toBe('ignored');
    expect(next.treemapStatus).toBe('loading');
    expect(next.activeDrawer).toBe('treemap');
    expect(cmds).toHaveLength(1);
  });

  it('j moves treemap focus between regions', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({
      activeDrawer: 'treemap',
      treemapStatus: 'ready',
      treemapReport: makeTreemapReport(),
    });
    const [next] = app.update(keyMsg('j'), model);
    expect(next.treemapFocus).toBe(1);
  });
});

describe('dashboard treemap drill shortcuts', () => {
  it('+ drills into the focused treemap region', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({
      activeDrawer: 'treemap',
      treemapStatus: 'ready',
      treemapReport: makeTreemapReport(),
    });
    const [next, cmds] = app.update(keyMsg('=', { shift: true }), model);
    expect(next.treemapPath).toEqual([{ kind: 'worktree', segments: ['src'], label: 'src' }]);
    expect(next.treemapStatus).toBe('loading');
    expect(cmds).toHaveLength(1);
  });

  it('- ascends to the parent treemap level', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({
      activeDrawer: 'treemap',
      treemapScope: 'repository',
      treemapStatus: 'ready',
      treemapPath: [{ kind: 'git', segments: ['.git/objects'], label: '.git/objects' }],
      treemapReport: makeTreemapReport({
        drillPath: [{ kind: 'git', segments: ['.git/objects'], label: '.git/objects' }],
        breadcrumb: ['repository', '.git/objects'],
        tiles: [{
          id: 'git:.git/objects/pack',
          label: 'pack',
          kind: 'git',
          value: 2048,
          detail: '2 git items · 2.0K on disk',
          drillable: true,
          path: { kind: 'git', segments: ['.git/objects', 'pack'], label: 'pack' },
        }],
      }),
    });
    const [next, cmds] = app.update(keyMsg('-'), model);
    expect(next.treemapPath).toEqual([]);
    expect(next.treemapStatus).toBe('loading');
    expect(cmds).toHaveLength(1);
  });
});

describe('dashboard refs shortcuts', () => {
  it('r opens the refs view and queues a load', () => {
    const app = createDashboardApp(makeDeps());
    const [next, cmds] = app.update(keyMsg('r'), makeModel());
    expect(next.activeDrawer).toBe('refs');
    expect(next.refsStatus).toBe('loading');
    expect(cmds).toHaveLength(1);
  });

  it('loaded-refs stores the inventory and enter switches the source', () => {
    const app = createDashboardApp(makeDeps());
    const refs = { namespaces: [{ namespace: 'refs/warp', count: 1, browsable: 1 }], refs: makeRefItems() };
    const [withRefs] = app.update({ type: 'loaded-refs', refs }, makeModel({ activeDrawer: 'refs', refsStatus: 'loading' }));
    const [next, cmds] = app.update(keyMsg('enter'), withRefs);
    expect(next.source).toEqual({ type: 'ref', ref: 'refs/warp/demo/seek-cache' });
    expect(next.activeDrawer).toBeNull();
    expect(next.status).toBe('loading');
    expect(cmds).toHaveLength(1);
  });
});

describe('dashboard data loading', () => {
  it('loaded-entries sets entries and fires manifest loads', () => {
    const app = createDashboardApp(makeDeps());
    const msg = { type: 'loaded-entries', entries, metadata: null, source: { type: 'vault' } };
    const [next, cmds] = app.update(msg, makeModel({ status: 'loading' }));
    expect(next.status).toBe('ready');
    expect(next.entries).toEqual(entries);
    expect(next.table.rows).toHaveLength(2);
    expect(cmds).toHaveLength(2);
  });

  it('loaded-manifest caches manifest', () => {
    const app = createDashboardApp(makeDeps());
    const manifest = { slug: 'alpha', size: 100, chunks: [] };
    const [next] = app.update({ type: 'loaded-manifest', slug: 'alpha', manifest, source: { type: 'vault' } }, makeModel());
    expect(next.manifestCache.get('alpha')).toBe(manifest);
  });

  it('ignores stale entry loads for a source that is no longer active', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({ source: { type: 'ref', ref: 'refs/warp/demo/seek-cache' } });
    const [next] = app.update({ type: 'loaded-entries', entries, metadata: null, source: { type: 'vault' } }, model);
    expect(next.entries).toEqual([]);
    expect(next.source).toEqual({ type: 'ref', ref: 'refs/warp/demo/seek-cache' });
  });
});

describe('dashboard report loading', () => {
  it('loaded-stats stores the stats report', () => {
    const app = createDashboardApp(makeDeps());
    const stats = makeStatsReport();
    const [next] = app.update({ type: 'loaded-stats', stats, source: { type: 'vault' } }, makeModel({ activeDrawer: 'stats', statsStatus: 'loading' }));
    expect(next.statsStatus).toBe('ready');
    expect(next.statsReport).toEqual(stats);
    expect(next.statsError).toBeNull();
  });

  it('loaded-doctor stores the doctor report', () => {
    const app = createDashboardApp(makeDeps());
    const report = makeDoctorReport();
    const [next] = app.update({ type: 'loaded-doctor', report, source: { type: 'vault' } }, makeModel({ activeDrawer: 'doctor', doctorStatus: 'loading' }));
    expect(next.doctorStatus).toBe('ready');
    expect(next.doctorReport).toEqual(report);
    expect(next.doctorError).toBeNull();
  });
});

describe('dashboard treemap report and toast messages', () => {
  it('loaded-treemap stores the report for the active scope', () => {
    const app = createDashboardApp(makeDeps());
    const report = makeTreemapReport({
      totalValue: 2048,
      tiles: [{
        id: 'worktree:src',
        label: 'src',
        kind: 'worktree',
        value: 2048,
        detail: '2 tracked paths · 2.0K on disk',
        drillable: true,
        path: { kind: 'worktree', segments: ['src'], label: 'src' },
      }],
      notes: [],
      summary: {
        bare: false,
        gitDir: '/tmp/git-cas-fixture/.git',
        worktreeItems: 1,
        worktreePaths: 1,
        refNamespaces: 1,
        refCount: 2,
        vaultEntries: 1,
        sourceEntries: 1,
      },
    });
    const [next] = app.update({ type: 'loaded-treemap', report }, makeModel({ activeDrawer: 'treemap', treemapStatus: 'loading' }));
    expect(next.treemapStatus).toBe('ready');
    expect(next.treemapReport).toEqual(report);
    expect(next.treemapError).toBeNull();
  });

  it('dismiss-toast removes the matching toast', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({
      toasts: [
        { id: 1, level: 'error', title: 'Failed to load entries', message: 'boom' },
        { id: 2, level: 'warning', title: 'Heads up', message: 'careful' },
      ],
    });
    const [next] = app.update({ type: 'dismiss-toast', id: 1 }, model);
    expect(next.toasts).toEqual([
      { id: 2, level: 'warning', title: 'Heads up', message: 'careful' },
    ]);
  });
});

describe('dashboard filter mode', () => {
  it('filter mode captures characters and filters entries', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({ filtering: true, entries, filtered: entries });
    const [next] = app.update(keyMsg('l'), model);
    expect(next.filterText).toBe('l');
    expect(next.filtered).toHaveLength(1);
    expect(next.table.rows).toHaveLength(1);
    expect(next.filtered[0].slug).toBe('alpha');
  });

  it('escape exits filter mode', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({ filtering: true, filterText: 'a' });
    const [next] = app.update(keyMsg('escape'), model);
    expect(next.filtering).toBe(false);
  });

  it('loaded-entries applies active filter', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({ status: 'loading', filterText: 'al', filtering: true });
    const msg = { type: 'loaded-entries', entries, metadata: null, source: { type: 'vault' } };
    const [next] = app.update(msg, model);
    expect(next.filtered).toHaveLength(1);
    expect(next.filtered[0].slug).toBe('alpha');
  });
});

describe('dashboard filter edge cases', () => {
  it('filter-backspace removes last char and re-filters', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({ filtering: true, filterText: 'al', entries, filtered: [entries[0]] });
    const [next] = app.update(keyMsg('backspace'), model);
    expect(next.filterText).toBe('a');
    expect(next.filtered).toHaveLength(2);
    expect(next.table.focusRow).toBe(0);
  });

  it('load-error from entries sets error and status on model', () => {
    const app = createDashboardApp(makeDeps());
    const [next, cmds] = app.update({ type: 'load-error', source: 'entries', forSource: { type: 'vault' }, error: 'boom' }, makeModel());
    expect(next.error).toBe('boom');
    expect(next.status).toBe('error');
    expect(next.toasts).toHaveLength(1);
    expect(next.toasts[0].title).toBe('Failed to load entries');
    expect(cmds).toHaveLength(1);
  });
});

describe('dashboard loading edge cases', () => {
  it('load-error from manifest does not set global error', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({ status: 'ready', entries, filtered: entries });
    const [next, cmds] = app.update({ type: 'load-error', source: 'manifest', slug: 'alpha', forSource: { type: 'vault' }, error: 'oops' }, model);
    expect(next.status).toBe('ready');
    expect(next.error).toBeNull();
    expect(next.toasts).toHaveLength(1);
    expect(next.toasts[0].title).toBe('Failed to load alpha');
    expect(cmds).toHaveLength(1);
  });

  it('loaded-entries clamps table focus to filtered bounds', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({
      status: 'loading',
      filterText: 'al',
      table: makeTable([], { overrides: { focusRow: 5 } }),
    });
    const msg = { type: 'loaded-entries', entries, metadata: null, source: { type: 'vault' } };
    const [next] = app.update(msg, model);
    expect(next.table.focusRow).toBe(0);
    expect(next.filtered).toHaveLength(1);
  });

  it('filter-start resets filtered to all entries', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({ entries, filtered: [entries[0]], filterText: 'al' });
    const [next] = app.update(keyMsg('/'), model);
    expect(next.filtered).toHaveLength(2);
    expect(next.filterText).toBe('');
  });

  it('select on uncached entry returns loadManifestCmd', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({ entries, filtered: entries });
    const [next, cmds] = app.update(keyMsg('enter'), model);
    expect(next.loadingSlug).toBe('alpha');
    expect(next.splitPane.focused).toBe('b');
    expect(cmds).toHaveLength(1);
  });
});

describe('dashboard view rendering', () => {
  it('renders a surface-native explorer layout on empty model', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const model = makeModel();
    const output = app.view(model);
    expect(typeof output).toBe('object');
    expect(output.width).toBe(model.columns);
    const rendered = renderView(output, deps.ctx);
    expect(rendered).toContain('git-cas repository explorer');
    expect(rendered).toContain('cwd /tmp/git-cas-fixture');
    expect(rendered).toContain('source vault refs/cas/vault');
    expect(rendered).toContain('Entries');
    expect(rendered).toContain('Inspector');
  });

  it('renders entry list when entries exist', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const model = makeModel({ entries, filtered: entries });
    const rendered = renderView(app.view(model), deps.ctx);
    expect(rendered).toContain('Slug');
    expect(rendered).toContain('alpha');
    expect(rendered).toContain('bravo');
  });

  it('renders encrypted header badge text without object coercion', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const model = makeModel({ metadata: { encryption: { cipher: 'aes-256-gcm' } } });
    const rendered = renderView(app.view(model), deps.ctx);
    expect(rendered).toContain('encrypted');
    expect(rendered).not.toContain('[object Object]');
  });

  it('renders error message on error status', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const model = makeModel({ status: 'error', error: 'connection failed' });
    const rendered = renderView(app.view(model), deps.ctx);
    expect(rendered).toContain('Error: connection failed');
  });
});

describe('dashboard footer rendering', () => {
  it('renders footer keybinding hints', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const model = makeModel({ columns: 120 });
    const rendered = renderView(app.view(model), deps.ctx);
    expect(rendered).toContain('inspect');
    expect(rendered).toContain('resize');
    expect(rendered).toContain('pane');
    expect(rendered).toContain('palette');
    expect(rendered).toContain('stats');
    expect(rendered).toContain('doctor');
    expect(rendered).toContain('treemap');
    expect(rendered).toContain('scope');
    expect(rendered).toContain('files');
    expect(rendered).toContain('refs');
    expect(rendered).toContain('clos');
    expect(rendered).toContain('quit');
  });

  it('renders treemap-specific footer hints in treemap mode', () => {
    const { rendered } = renderDashboardWithModel({
      activeDrawer: 'treemap',
      treemapStatus: 'ready',
      treemapReport: makeTreemapReport(),
      columns: 120,
    });
    expect(rendered).toContain('back');
    expect(rendered).toContain('descend');
    expect(rendered).toContain('ascend');
  });
});

describe('dashboard inspector rendering', () => {
  it('renders selected asset summary in the inspector pane', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const manifest = { slug: 'alpha', size: 1536, chunks: [{ index: 0, size: 1536, digest: 'abcd1234efgh5678' }] };
    const model = makeModel({
      entries,
      filtered: entries,
      manifestCache: new Map([['alpha', manifest]]),
    });
    const rendered = renderView(app.view(model), deps.ctx);
    expect(rendered).toContain('asset alpha');
    expect(rendered).toContain('chunks    1');
  });

  it('renders inspector focus chrome when pane b is active', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const model = makeModel({ splitPane: createSplitPaneState({ ratio: 0.37, focused: 'b' }) });
    const rendered = renderView(app.view(model), deps.ctx);
    expect(rendered).toContain('Inspector *');
  });
});

describe('dashboard report overlay rendering', () => {
  it('renders the stats drawer overlay', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const model = makeModel({
      activeDrawer: 'stats',
      statsStatus: 'ready',
      statsReport: makeStatsReport(),
    });
    const rendered = renderView(app.view(model), deps.ctx);
    expect(rendered).toContain('Source Stats');
    expect(rendered).toContain('dedup-ratio');
    expect(rendered).not.toContain('\t');
  });

  it('renders the doctor drawer loading state', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const rendered = renderView(app.view(makeModel({ activeDrawer: 'doctor', doctorStatus: 'loading' })), deps.ctx);
    expect(rendered).toContain('Doctor Report');
    expect(rendered).toContain('Loading doctor report');
  });
});

describe('dashboard treemap rendering', () => {
  it('renders the treemap as a full-screen view with a details sidebar', () => {
    const { rendered } = renderDashboardWithModel(makeFullScreenTreemapModel());
    expect(rendered).toContain('treemap view');
    expect(rendered).toContain('Repository Map');
    expect(rendered).toContain('Treemap Details');
    expect(rendered).toContain('Overview');
    expect(rendered).toContain('Focused Region');
    expect(rendered).toContain('Legend');
    expect(rendered).toContain('Largest Regions');
    expect(rendered).toContain('scope repository');
    expect(rendered).toContain('files tracked');
    expect(rendered).toContain('level repository');
    expect(rendered).toContain('focus s');
    expect(rendered).toContain('other');
    expect(rendered).toContain('2 tracked paths');
    expect(rendered).toContain('Repository view mixes Git-reported');
  });

  it('renders an actionable empty-source message in source treemap mode', () => {
    const { rendered } = renderDashboardWithModel({
      activeDrawer: 'treemap',
      treemapScope: 'source',
      treemapStatus: 'ready',
      treemapReport: makeTreemapReport({
        scope: 'source',
        breadcrumb: ['source'],
        totalValue: 0,
        tiles: [{ id: 'meta:empty-source', label: 'empty source', kind: 'meta', value: 1, detail: 'No CAS entries resolved for this source', drillable: false, path: null }],
        notes: [
          'No CAS entries resolved for the vault. Press r to browse refs or T to return to repository scope.',
          'Source view weights tiles by logical manifest size.',
        ],
        summary: {
          bare: false,
          gitDir: '/tmp/git-cas-fixture/.git',
          worktreeItems: 0,
          worktreePaths: 0,
          refNamespaces: 0,
          refCount: 0,
          vaultEntries: 0,
          sourceEntries: 0,
        },
      }),
    });
    expect(rendered).toContain('No CAS entries were resolved for the current source.');
    expect(rendered).toContain('Press r to browse refs');
  });
});

describe('dashboard refs rendering', () => {
  it('renders the refs browser as a full-screen view', () => {
    const { rendered } = renderDashboardWithModel({
      activeDrawer: 'refs',
      refsStatus: 'ready',
      refsItems: makeRefItems(),
      columns: 120,
      rows: 36,
    });
    expect(rendered).toContain('refs view');
    expect(rendered).toContain('Refs');
    expect(rendered).toContain('Ref Details');
    expect(rendered).toContain('refs/warp/demo/seek-cache');
    expect(rendered).toContain('Press enter to switch source');
  });
});

describe('dashboard palette rendering', () => {
  it('renders the palette badge when the command palette is open', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const [withPalette] = app.update(keyMsg('p', { ctrl: true }), makeModel());
    const rendered = renderView(app.view(withPalette), deps.ctx);
    expect(rendered).toContain('palette');
    expect(rendered).toContain('Command Palette');
    expect(rendered).toContain('Open Repo Treemap');
    expect(rendered).toContain('Open Source Stats');
  });

  it('renders stacked toast notifications', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const rendered = renderView(app.view(makeModel({
      toasts: [
        { id: 2, level: 'warning', title: 'Heads up', message: 'yellow alert' },
        { id: 1, level: 'error', title: 'Failed to load repo treemap', message: 'boom' },
      ],
    })), deps.ctx);
    expect(rendered).toContain('alerts 2');
    expect(rendered).toContain('Error: Failed to load repo treemap');
    expect(rendered).toContain('Warning: Heads up');
  });
});
