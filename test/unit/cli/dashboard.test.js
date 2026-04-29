import { describe, it, expect, vi } from 'vitest';
import { surfaceToString } from '@flyingrobots/bijou';
import { createNavigableTableState, createNotificationState } from '@flyingrobots/bijou-tui';
import { makeCtx } from './_testContext.js';

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
    ...overrides,
  };
}

function makeModel(overrides = {}) {
  const rows = 24;
  return {
    phase: 'dashboard',
    titleTimeMs: 0,
    vaultEntryCount: 0,
    passphrase: '',
    authError: null,
    status: 'idle',
    columns: 80,
    rows,
    source: { type: 'vault' },
    entries: [],
    filtered: [],
    filterText: '',
    filtering: false,
    metadata: null,
    manifestCache: new Map(),
    loadingSlug: null,
    detailPager: null,
    detailAccordion: null,
    error: null,
    table: createNavigableTableState({ columns: [], rows: [], height: 10 }),
    refsTable: createNavigableTableState({ columns: [], rows: [], height: 10 }),
    refsItems: [],
    activeDrawer: null,
    viewMode: 'list',
    viewTransition: null,
    palette: null,
    notifications: createNotificationState(),
    showHelp: false,
    dagPane: null,
    promptEnter: false,
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
    expect(rendered).toContain('git-cas');
    expect(rendered).toContain('repository explorer');
  });
});

describe('dashboard treemap rendering', () => {
  it('renders the treemap panel with title', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const rendered = renderView(app.view(makeModel({ activeDrawer: 'treemap', treemapReport: { tiles: [], breadcrumb: ['root'], totalValue: 0, notes: [], summary: {}, scope: 'repository', source: { type: 'vault' }, cwd: '/test' } })), deps.ctx);
    expect(rendered).toContain('Repository Atlas');
  });
});

describe('dashboard refs rendering', () => {
  it('renders the refs index panel', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const rendered = renderView(app.view(makeModel({ activeDrawer: 'refs' })), deps.ctx);
    expect(rendered).toContain('Ref Index');
  });
});
