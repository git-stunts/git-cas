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

function makeModel(overrides = {}) {
  const manifestCache = overrides.manifestCache || new Map();
  const filtered = overrides.filtered || overrides.entries || [];
  const rows = overrides.rows || 24;
  return {
    status: 'ready',
    columns: 80,
    rows: 24,
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
    splitPane: createSplitPaneState({ ratio: 0.37, focused: 'a' }),
    palette: null,
    activeDrawer: null,
    statsStatus: 'idle',
    statsReport: null,
    statsError: null,
    doctorStatus: 'idle',
    doctorReport: null,
    doctorError: null,
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

describe('dashboard overlays', () => {
  it('ctrl+p opens the command palette', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const [next] = app.update(keyMsg('p', { ctrl: true }), makeModel());
    expect(next.palette).not.toBeNull();
    const rendered = renderView(app.view(next), deps.ctx);
    expect(rendered).toContain('Command Palette');
    expect(rendered).toContain('Open Source Stats');
  });

  it('palette selection opens the stats drawer and queues a load', () => {
    const app = createDashboardApp(makeDeps());
    const [withPalette] = app.update(keyMsg('p', { ctrl: true }), makeModel());
    const [next, cmds] = app.update(keyMsg('enter'), withPalette);
    expect(next.palette).toBeNull();
    expect(next.activeDrawer).toBe('stats');
    expect(next.statsStatus).toBe('loading');
    expect(cmds).toHaveLength(1);
  });

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

describe('dashboard data loading', () => {
  it('loaded-entries sets entries and fires manifest loads', () => {
    const app = createDashboardApp(makeDeps());
    const msg = { type: 'loaded-entries', entries, metadata: null };
    const [next, cmds] = app.update(msg, makeModel({ status: 'loading' }));
    expect(next.status).toBe('ready');
    expect(next.entries).toEqual(entries);
    expect(next.table.rows).toHaveLength(2);
    expect(cmds).toHaveLength(2);
  });

  it('loaded-manifest caches manifest', () => {
    const app = createDashboardApp(makeDeps());
    const manifest = { slug: 'alpha', size: 100, chunks: [] };
    const [next] = app.update({ type: 'loaded-manifest', slug: 'alpha', manifest }, makeModel());
    expect(next.manifestCache.get('alpha')).toBe(manifest);
  });
});

describe('dashboard report loading', () => {
  it('loaded-stats stores the stats report', () => {
    const app = createDashboardApp(makeDeps());
    const stats = makeStatsReport();
    const [next] = app.update({ type: 'loaded-stats', stats }, makeModel({ activeDrawer: 'stats', statsStatus: 'loading' }));
    expect(next.statsStatus).toBe('ready');
    expect(next.statsReport).toEqual(stats);
    expect(next.statsError).toBeNull();
  });

  it('loaded-doctor stores the doctor report', () => {
    const app = createDashboardApp(makeDeps());
    const report = makeDoctorReport();
    const [next] = app.update({ type: 'loaded-doctor', report }, makeModel({ activeDrawer: 'doctor', doctorStatus: 'loading' }));
    expect(next.doctorStatus).toBe('ready');
    expect(next.doctorReport).toEqual(report);
    expect(next.doctorError).toBeNull();
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
    const msg = { type: 'loaded-entries', entries, metadata: null };
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
    const [next] = app.update({ type: 'load-error', source: 'entries', error: 'boom' }, makeModel());
    expect(next.error).toBe('boom');
    expect(next.status).toBe('error');
  });
});

describe('dashboard loading edge cases', () => {
  it('load-error from manifest does not set global error', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({ status: 'ready', entries, filtered: entries });
    const [next] = app.update({ type: 'load-error', source: 'manifest', slug: 'alpha', error: 'oops' }, model);
    expect(next.status).toBe('ready');
    expect(next.error).toBeNull();
  });

  it('loaded-entries clamps table focus to filtered bounds', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({
      status: 'loading',
      filterText: 'al',
      table: makeTable([], { overrides: { focusRow: 5 } }),
    });
    const msg = { type: 'loaded-entries', entries, metadata: null };
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

describe('dashboard footer and inspector rendering', () => {
  it('renders footer keybinding hints', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const model = makeModel();
    const rendered = renderView(app.view(model), deps.ctx);
    expect(rendered).toContain('inspect');
    expect(rendered).toContain('resize');
    expect(rendered).toContain('pane');
    expect(rendered).toContain('palette');
    expect(rendered).toContain('stats');
    expect(rendered).toContain('doctor');
    expect(rendered).toContain('close');
    expect(rendered).toContain('quit');
  });

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

describe('dashboard overlay rendering', () => {
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
  });

  it('renders the doctor drawer loading state', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const rendered = renderView(app.view(makeModel({ activeDrawer: 'doctor', doctorStatus: 'loading' })), deps.ctx);
    expect(rendered).toContain('Doctor Report');
    expect(rendered).toContain('Loading doctor report');
  });

  it('renders the palette badge when the command palette is open', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const [withPalette] = app.update(keyMsg('p', { ctrl: true }), makeModel());
    const rendered = renderView(app.view(withPalette), deps.ctx);
    expect(rendered).toContain('palette');
    expect(rendered).toContain('Command Palette');
    expect(rendered).toContain('Open Source Stats');
  });
});
