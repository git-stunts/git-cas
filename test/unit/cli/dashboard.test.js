import { describe, it, expect, vi } from 'vitest';
import { surfaceToString } from '@flyingrobots/bijou';
import { createNavigableTableState, createNotificationState } from '@flyingrobots/bijou-tui';
import { makeCtx } from './_testContext.js';
import { createFeedState } from '../../../bin/ui/blocks/operation-feed.js';

vi.mock('../../../bin/ui/context.js', () => ({
  getCliContext: () => makeCtx(),
  createCliTuiContext: () => makeCtx(),
}));

const { createDashboardApp } = await import('../../../bin/ui/dashboard.js');

function makeDeps(overrides = {}) {
  const ctx = makeCtx();
  return {
    keyMap: { handle: () => null },
    cas: {
      listVault: vi.fn().mockResolvedValue([]),
      getVaultMetadata: vi.fn().mockResolvedValue({}),
      readManifest: vi.fn(),
      verifyIntegrity: vi.fn(),
    },
    ctx,
    cwdLabel: '/tmp/git-cas-fixture',
    source: { type: 'vault' },
    tick: vi.fn((ms, msg) => ({ type: 'tick', ms, msg })),
    ...overrides,
  };
}

function modelCoreDefaults() {
  return {
    phase: 'dashboard',
    titleTimeMs: 0,
    lastTickTime: 0,
    fps: 0,
    showPerfHud: false,
    vaultEntryCount: 0,
    passphrase: '',
    authError: null,
    status: 'idle',
    columns: 80,
    rows: 24,
    source: { type: 'vault' },
    workspace: 'explorer',
    explorerMode: 'ledger',
    merkleMode: 'table',
    entries: [],
    filtered: [],
    filterText: '',
    filtering: false,
    metadata: null,
    manifestCache: new Map(),
    loadingSlug: null,
    quitConfirm: false,
    storeWizard: null,
    error: null,
    table: createNavigableTableState({ columns: [], rows: [], height: 10 }),
    palette: null,
    showHelp: false,
  };
}

function modelServiceDefaults() {
  return {
    refsStatus: 'idle',
    refsInventory: null,
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
    notifications: createNotificationState(),
    operationFeed: createFeedState(),
    gitBranch: null,
    promptEnter: false,
  };
}

function makeModel(overrides = {}) {
  return {
    ...modelCoreDefaults(),
    ...modelServiceDefaults(),
    ...overrides,
  };
}

function renderView(view, ctx) {
  if (typeof view === 'string') {
    return view;
  }
  return surfaceToString(view, ctx.style);
}

describe('dashboard basic rendering', () => {
  it('renders themed dashboard headers', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const rendered = renderView(app.view(makeModel()), deps.ctx);
    expect(rendered).toContain('git-cas cockpit');
    expect(rendered).toContain('Explorer');
    expect(rendered).toContain('Atlas');
    expect(rendered).toContain('Operations');
    expect(rendered).toContain('Asset Ledger');
  });

  it('renders entry list when entries exist', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const model = makeModel({
      entries: [{ slug: 'alpha', treeOid: 'abc' }],
      filtered: [{ slug: 'alpha', treeOid: 'abc' }],
      table: createNavigableTableState({ 
        columns: [{ header: 'Slug', width: 20 }, { header: 'Size', width: 10 }],
        rows: [['alpha', 'abc', '100B', '1', 'plain', 'raw', 'single']], 
        height: 10 
      })
    });
    const rendered = renderView(app.view(model), deps.ctx);
    expect(rendered).toContain('alpha');
  });
  it('opens command palette for digest search', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const model = makeModel({
      entries: [{ slug: 'alpha', treeOid: 'abc' }],
      filtered: [{ slug: 'alpha', treeOid: 'abc' }],
      manifestCache: new Map([['alpha', {
        chunks: [{ digest: 'sha256:deadbeef', blob: 'blob-1' }],
      }]]),
    });
    const [next] = app.update({ type: 'key', key: 'p', ctrl: true }, model);
    const [queried] = app.update({ type: 'key', key: 'd' }, next);
    expect(queried.palette.query).toBe('d');
    expect(queried.palette.filteredItems[0].id).toBe('alpha');
  });
});

function treemapReport() {
  return {
    tiles: [{
      id: 'app',
      label: 'app',
      kind: 'worktree',
      value: 4096,
      detail: 'source files',
      drillable: true,
      path: 'app',
    }],
    breadcrumb: ['root'],
    totalValue: 4096,
    notes: ['fixture repository atlas'],
    summary: {
      worktreePaths: 1,
      worktreeItems: 1,
      refCount: 0,
      refNamespaces: 0,
      vaultEntries: 1,
      sourceEntries: 1,
    },
    scope: 'repository',
    source: { type: 'vault' },
    cwd: '/test',
    worktreeMode: 'tracked',
  };
}

describe('dashboard atlas rendering', () => {
  it('renders the treemap panel with title', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const rendered = renderView(app.view(makeModel({ workspace: 'atlas', treemapStatus: 'ready', treemapReport: treemapReport(), columns: 120 })), deps.ctx);
    expect(rendered).toContain('Repository Atlas');
    expect(rendered).toContain('Atlas Briefing');
    expect(rendered).toContain('app');
  });

  it('switches to atlas and queues a treemap load', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const [next, cmds] = app.update({ type: 'key', key: '2' }, makeModel());
    expect(next.workspace).toBe('atlas');
    expect(next.treemapStatus).toBe('loading');
    expect(cmds).toHaveLength(1);
  });
});

describe('dashboard operations rendering', () => {
  it('renders the operations deck', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const rendered = renderView(app.view(makeModel({ workspace: 'operations', columns: 120 })), deps.ctx);
    expect(rendered).toContain('Vault Economics');
    expect(rendered).toContain('Operations Deck');
  });
});
