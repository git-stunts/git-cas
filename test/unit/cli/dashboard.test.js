import { describe, it, expect, vi } from 'vitest';
import { makeCtx } from './_testContext.js';

vi.mock('../../../bin/ui/context.js', () => ({
  getCliContext: () => makeCtx(),
}));

const { createDashboardApp, createKeyBindings } = await import('../../../bin/ui/dashboard.js');

function mockCas() {
  return {
    listVault: vi.fn().mockResolvedValue([]),
    getVaultMetadata: vi.fn().mockResolvedValue(null),
    readManifest: vi.fn().mockResolvedValue(null),
  };
}

function makeDeps() {
  return { keyMap: createKeyBindings(), cas: mockCas(), ctx: makeCtx() };
}

function makeModel(overrides = {}) {
  return {
    status: 'ready',
    columns: 80,
    rows: 24,
    entries: [],
    filtered: [],
    cursor: 0,
    filterText: '',
    filtering: false,
    metadata: null,
    manifestCache: new Map(),
    loadingSlug: null,
    detailScroll: 0,
    error: null,
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

describe('dashboard init and navigation', () => {
  it('init returns loading model with one cmd', () => {
    const app = createDashboardApp(makeDeps());
    const [model, cmds] = app.init();
    expect(model.status).toBe('loading');
    expect(cmds).toHaveLength(1);
  });

  it('move cursor down', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({ filtered: entries, entries });
    const [next] = app.update(keyMsg('j'), model);
    expect(next.cursor).toBe(1);
  });

  it('move cursor up clamps at 0', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({ filtered: entries, entries });
    const [next] = app.update(keyMsg('k'), model);
    expect(next.cursor).toBe(0);
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

  it('resize updates dimensions', () => {
    const app = createDashboardApp(makeDeps());
    const [next] = app.update({ type: 'resize', columns: 120, rows: 40 }, makeModel());
    expect(next.columns).toBe(120);
    expect(next.rows).toBe(40);
  });
});

describe('dashboard data loading', () => {
  it('loaded-entries sets entries and fires manifest loads', () => {
    const app = createDashboardApp(makeDeps());
    const msg = { type: 'loaded-entries', entries, metadata: null };
    const [next, cmds] = app.update(msg, makeModel({ status: 'loading' }));
    expect(next.status).toBe('ready');
    expect(next.entries).toEqual(entries);
    expect(cmds).toHaveLength(2);
  });

  it('loaded-manifest caches manifest', () => {
    const app = createDashboardApp(makeDeps());
    const manifest = { slug: 'alpha', size: 100, chunks: [] };
    const [next] = app.update({ type: 'loaded-manifest', slug: 'alpha', manifest }, makeModel());
    expect(next.manifestCache.get('alpha')).toBe(manifest);
  });

  it('filter mode captures characters and filters entries', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({ filtering: true, entries, filtered: entries });
    const [next] = app.update(keyMsg('l'), model);
    expect(next.filterText).toBe('l');
    expect(next.filtered).toHaveLength(1);
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

describe('dashboard edge cases', () => {
  it('filter-backspace removes last char and re-filters', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({ filtering: true, filterText: 'al', entries, filtered: [entries[0]] });
    const [next] = app.update(keyMsg('backspace'), model);
    expect(next.filterText).toBe('a');
    expect(next.filtered).toHaveLength(2);
    expect(next.cursor).toBe(0);
  });

  it('load-error sets error and status on model', () => {
    const app = createDashboardApp(makeDeps());
    const [next] = app.update({ type: 'load-error', error: 'boom' }, makeModel());
    expect(next.error).toBe('boom');
    expect(next.status).toBe('error');
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
    const model = makeModel({ entries, filtered: entries, cursor: 0 });
    const [next, cmds] = app.update(keyMsg('enter'), model);
    expect(next.loadingSlug).toBe('alpha');
    expect(cmds).toHaveLength(1);
  });
});

describe('dashboard view rendering', () => {
  it('renders without errors on empty model', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel();
    const output = app.view(model);
    expect(typeof output).toBe('string');
    expect(output).toContain('0 entries');
  });

  it('renders entry list when entries exist', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({ entries, filtered: entries });
    const output = app.view(model);
    expect(output).toContain('alpha');
    expect(output).toContain('bravo');
  });

  it('renders error message on error status', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel({ status: 'error', error: 'connection failed' });
    const output = app.view(model);
    expect(output).toContain('Error: connection failed');
  });

  it('renders footer keybinding hints', () => {
    const app = createDashboardApp(makeDeps());
    const model = makeModel();
    const output = app.view(model);
    expect(output).toContain('Navigate');
    expect(output).toContain('Quit');
  });
});
