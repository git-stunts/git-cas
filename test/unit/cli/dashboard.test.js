import { describe, it, expect, vi } from 'vitest';
import { surfaceToString } from '@flyingrobots/bijou';
import { createNavigableTableState, wrapPageMsg } from '@flyingrobots/bijou-tui';
import { makeCtx } from './_testContext.js';
import { createFeedState } from '../../../bin/ui/blocks/operation-feed.js';

vi.mock('../../../bin/ui/context.js', () => ({
  getCliContext: () => makeCtx(),
  createCliTuiContext: () => makeCtx(),
}));

const { createDashboardApp: createFramedDashboardApp, createDashboardPage } =
  await import('../../../bin/ui/dashboard.js');

function createDashboardApp(deps) {
  const page = createDashboardPage(deps);
  return {
    init: page.init,
    update: page.update,
    view(model) {
      return page.layout(model).render(model.columns, model.rows);
    },
  };
}

function makeDeps(overrides = {}) {
  const ctx = makeCtx();
  const { cas: casOverrides = {}, ...rest } = overrides;
  return {
    keyMap: { handle: () => null },
    cas: {
      listVault: vi.fn().mockResolvedValue([]),
      getVaultMetadata: vi.fn().mockResolvedValue({}),
      readManifest: vi.fn(),
      verifyIntegrity: vi.fn(),
      deriveKey: vi
        .fn()
        .mockResolvedValue({ key: Buffer.alloc(32), salt: Buffer.from('salt'), params: {} }),
      getService: vi.fn(),
      getVaultService: vi.fn(),
      ...casOverrides,
    },
    ctx,
    cwdLabel: '/tmp/git-cas-fixture',
    source: { type: 'vault' },
    tick: vi.fn((ms, msg) => ({ type: 'tick', ms, msg })),
    ...rest,
  };
}

function modelCoreDefaults() {
  return {
    phase: 'dashboard',
    titleTimeMs: 0,
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
    focusPane: 'ledger',
    chunkFocus: 0,
    vaultEncryptionKey: null,
    entries: [],
    filtered: [],
    filterText: '',
    metadata: null,
    manifestCache: new Map(),
    loadingSlug: null,
    storeWizard: null,
    error: null,
    table: createNavigableTableState({ columns: [], rows: [], height: 10 }),
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

async function dispatchFrameKey(app, model, key) {
  const [routed, commands] = app.update(
    {
      type: 'key',
      key,
      ctrl: false,
      alt: false,
      shift: false,
    },
    model
  );
  let next = routed;
  for (const command of commands) {
    const message = await command();
    if (message !== undefined) {
      [next] = app.update(message, next);
    }
  }
  return next;
}

describe('hosted dashboard frame', () => {
  it('owns settings, performance telemetry, and quit confirmation', () => {
    const deps = makeDeps();
    const app = createFramedDashboardApp(deps);
    const [initial] = app.init();

    expect(initial.activePageId).toBe('cockpit');
    expect(initial.settingsOpen).toBe(false);
    expect(initial.perfHudOpen).toBe(false);
    expect(initial.quitConfirmOpen).toBe(false);

    const [settings] = app.update(
      { type: 'key', key: 'f2', ctrl: false, alt: false, shift: false },
      initial
    );
    expect(settings.settingsOpen).toBe(true);
    expect(renderView(app.view(settings), deps.ctx)).toContain('Cockpit Settings');

    const [closedSettings] = app.update(
      { type: 'key', key: 'escape', ctrl: false, alt: false, shift: false },
      settings
    );
    const [performance] = app.update(
      { type: 'key', key: '`', ctrl: false, alt: false, shift: false },
      closedSettings
    );
    expect(performance.perfHudOpen).toBe(true);

    const [quitRequested] = app.update(
      { type: 'key', key: 'q', ctrl: false, alt: false, shift: false },
      performance
    );
    expect(quitRequested.quitConfirmOpen).toBe(true);
  });
});

describe('hosted dashboard active input', () => {
  it('routes ordinary and shell-reserved characters to the password page', async () => {
    const deps = makeDeps();
    const app = createFramedDashboardApp(deps);
    const [initial] = app.init();
    const seeded = {
      ...initial,
      pageModels: {
        ...initial.pageModels,
        cockpit: makeModel({ phase: 'password', passphrase: '' }),
      },
    };

    let next = await dispatchFrameKey(app, seeded, 'a');
    next = await dispatchFrameKey(app, next, 'q');
    next = await dispatchFrameKey(app, next, '/');
    next = await dispatchFrameKey(app, next, '?');

    expect(next.pageModels.cockpit.passphrase).toBe('aq/?');
    expect(next.quitConfirmOpen).toBe(false);
    expect(next.helpOpen).toBe(false);
    expect(next.commandPalette).toBeUndefined();
  });
});

describe('hosted dashboard search', () => {
  it('owns asset search and dispatches the selected page action', async () => {
    const deps = makeDeps();
    const app = createFramedDashboardApp(deps);
    const [initial] = app.init();
    const cockpit = makeModel({
      entries: [{ slug: 'alpha', treeOid: 'abc' }],
      filtered: [{ slug: 'alpha', treeOid: 'abc' }],
      manifestCache: new Map([
        [
          'alpha',
          {
            chunks: [{ digest: 'sha256:deadbeef', blob: 'blob-1' }],
          },
        ],
      ]),
    });
    const seeded = {
      ...initial,
      pageModels: { ...initial.pageModels, cockpit },
    };

    const [search] = app.update(
      { type: 'key', key: '/', ctrl: false, alt: false, shift: false },
      seeded
    );
    expect(search.commandPaletteKind).toBe('search');

    const [queried] = app.update(
      { type: 'key', key: 'd', ctrl: false, alt: false, shift: false },
      search
    );
    expect(queried.commandPalette.query).toBe('d');
    expect(queried.commandPalette.filteredItems[0].label).toBe('alpha');

    const [closed, commands] = app.update(
      { type: 'key', key: 'enter', ctrl: false, alt: false, shift: false },
      queried
    );
    expect(closed.commandPalette).toBeUndefined();
    expect(commands).toHaveLength(1);

    const pageMessage = await commands[0]();
    const [selected] = app.update(pageMessage, closed);
    expect(selected.pageModels.cockpit.workspace).toBe('explorer');
    expect(selected.pageModels.cockpit.explorerMode).toBe('manifest');
    expect(selected.pageModels.cockpit.filterText).toBe('alpha');
  });
});

describe('hosted dashboard notifications', () => {
  it('routes page failures into frame-managed notifications', async () => {
    const deps = makeDeps();
    const app = createFramedDashboardApp(deps);
    const [initial] = app.init();
    const seeded = {
      ...initial,
      pageModels: { ...initial.pageModels, cockpit: makeModel() },
    };

    const [failed, commands] = app.update(
      wrapPageMsg('cockpit', {
        type: 'load-error',
        source: 'entries',
        error: 'object read failed',
      }),
      seeded
    );
    expect(failed.pageModels.cockpit.error).toBe('object read failed');
    expect(commands).toHaveLength(1);

    const notificationMessage = await commands[0]();
    const [notified] = app.update(notificationMessage, failed);
    expect(notified.runtimeNotifications.items).toHaveLength(1);
    expect(notified.runtimeNotifications.items[0]).toMatchObject({
      title: 'Dashboard load failed',
      message: 'object read failed',
      tone: 'ERROR',
    });
  });
});

describe('dashboard basic rendering', () => {
  it('renders themed dashboard headers', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const rendered = renderView(app.view(makeModel()), deps.ctx);
    expect(rendered).not.toContain('git-cas cockpit');
    expect(rendered).toContain('Explorer');
    expect(rendered).toContain('Atlas');
    expect(rendered).toContain('Operations');
    expect(rendered).toContain('Asset Ledger');
    expect(rendered.split('\n').slice(0, 4).join('\n')).not.toContain('palette ctrl+p');
  });

  it('renders entry list when entries exist', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const model = makeModel({
      entries: [{ slug: 'alpha', treeOid: 'abc' }],
      filtered: [{ slug: 'alpha', treeOid: 'abc' }],
      table: createNavigableTableState({
        columns: [
          { header: 'Slug', width: 20 },
          { header: 'Size', width: 10 },
        ],
        rows: [['alpha', 'abc', '100B', '1', 'plain', 'raw', 'single']],
        height: 10,
      }),
    });
    const rendered = renderView(app.view(model), deps.ctx);
    expect(rendered).toContain('alpha');
  });
});

describe('dashboard detail chrome', () => {
  it('paginates detail chunks and expands the selected digest in the footer', () => {
    const deps = makeDeps();
    const app = createDashboardApp(deps);
    const chunks = Array.from({ length: 30 }, (_, index) => ({
      index,
      size: 2048,
      digest: `sha256:${String(index).padStart(2, '0')}${'a'.repeat(56)}`,
      blob: `blob-${String(index).padStart(2, '0')}-${'b'.repeat(36)}`,
    }));
    const entry = { slug: 'alpha', treeOid: 'f'.repeat(40) };
    const model = makeModel({
      columns: 220,
      rows: 42,
      entries: [entry],
      filtered: [entry],
      explorerMode: 'manifest',
      focusPane: 'detail',
      chunkFocus: 25,
      manifestCache: new Map([
        [
          'alpha',
          {
            slug: 'alpha',
            filename: 'alpha.bin',
            size: 61440,
            chunks,
          },
        ],
      ]),
      table: createNavigableTableState({
        columns: [
          { header: 'Slug', width: 20 },
          { header: 'Tree OID', width: 14 },
        ],
        rows: [['alpha', 'f'.repeat(40), '60.0K', '30', 'plain', 'manifest', 'loaded']],
        height: 10,
      }),
    });
    const rendered = renderView(app.view(model), deps.ctx);
    expect(rendered).toContain('Chunk Ledger (30)');
    expect(rendered).toContain('Showing 24-30 of 30');
    expect(rendered).toContain('Page 2/2');
    expect(rendered).toContain(`${chunks[25].digest.slice(0, 20)}...`);
    expect(rendered).toContain(chunks[25].digest);
  });
});

function encryptedMetadata() {
  return {
    encryption: {
      kdf: {
        algorithm: 'pbkdf2',
        salt: Buffer.from('salt').toString('base64'),
        iterations: 100000,
        keyLength: 32,
      },
    },
  };
}

describe('dashboard vault lock detection', () => {
  it('keeps encrypted vaults locked when entry listing fails before unlock', async () => {
    const listVault = vi.fn().mockRejectedValue(new Error('missing key'));
    const deps = makeDeps({
      cas: {
        getVaultMetadata: vi.fn().mockResolvedValue(encryptedMetadata()),
        listVault,
      },
    });
    const app = createDashboardApp(deps);
    const [model, cmds] = app.init();
    const msg = await cmds[0]();
    const [next] = app.update(msg, model);
    expect(msg.encrypted).toBe(true);
    expect(listVault).not.toHaveBeenCalled();
    expect(next.phase).toBe('password');
  });
});

describe('dashboard vault passphrase handling', () => {
  it('rejects an incorrect encrypted vault passphrase', async () => {
    const encryptionKey = Buffer.alloc(32, 7);
    const deps = makeDeps({
      cas: {
        getVaultMetadata: vi.fn().mockResolvedValue(encryptedMetadata()),
        deriveKey: vi
          .fn()
          .mockResolvedValue({ key: encryptionKey, salt: Buffer.from('salt'), params: {} }),
        listVault: vi.fn().mockResolvedValue([{ slug: 'alpha', treeOid: 'abc' }]),
        readManifest: vi.fn().mockResolvedValue({ encryption: { encrypted: true }, chunks: [] }),
        verifyIntegrity: vi.fn().mockResolvedValue(false),
      },
    });
    const app = createDashboardApp(deps);
    const [pending, cmds] = app.update(
      { type: 'key', key: 'enter' },
      makeModel({
        phase: 'password',
        metadata: encryptedMetadata(),
        passphrase: 'wrong',
      })
    );
    const msg = await cmds[0]();
    const [failed] = app.update(msg, pending);
    expect(msg).toEqual({ type: 'vault-auth-fail', error: 'Wrong passphrase' });
    expect(failed.phase).toBe('password');
    expect(failed.authError).toBe('Wrong passphrase');
    expect(failed.passphrase).toBe('');
  });
});

describe('dashboard vault key threading', () => {
  it('threads the derived encryption key into the dashboard entry load after unlock', async () => {
    const encryptionKey = Buffer.alloc(32, 9);
    const listVault = vi.fn().mockResolvedValue([]);
    const deps = makeDeps({
      cas: {
        getVaultMetadata: vi.fn().mockResolvedValue(encryptedMetadata()),
        deriveKey: vi
          .fn()
          .mockResolvedValue({ key: encryptionKey, salt: Buffer.from('salt'), params: {} }),
        listVault,
        readManifest: vi.fn(),
        verifyIntegrity: vi.fn().mockResolvedValue(true),
      },
    });
    const app = createDashboardApp(deps);
    const [pending, authCmds] = app.update(
      { type: 'key', key: 'enter' },
      makeModel({
        phase: 'password',
        metadata: encryptedMetadata(),
        passphrase: 'correct',
      })
    );
    const authMsg = await authCmds[0]();
    const [unlocked, loadCmds] = app.update(authMsg, pending);
    await loadCmds[0]();
    expect(unlocked.phase).toBe('dashboard');
    expect(unlocked.vaultEncryptionKey).toBe(encryptionKey);
    expect(listVault).toHaveBeenLastCalledWith({ encryptionKey });
  });
});

function treemapReport() {
  return {
    tiles: [
      {
        id: 'app',
        label: 'app',
        kind: 'worktree',
        value: 4096,
        detail: 'source files',
        drillable: true,
        path: 'app',
      },
    ],
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
    const rendered = renderView(
      app.view(
        makeModel({
          workspace: 'atlas',
          treemapStatus: 'ready',
          treemapReport: treemapReport(),
          columns: 120,
        })
      ),
      deps.ctx
    );
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
    const rendered = renderView(
      app.view(makeModel({ workspace: 'operations', columns: 120 })),
      deps.ctx
    );
    expect(rendered).toContain('Vault Economics');
    expect(rendered).toContain('Operations Deck');
  });
});

describe('dashboard operations commands', () => {
  it('threads the unlocked vault key into operations doctor scans', async () => {
    const encryptionKey = Buffer.alloc(32, 4);
    const readState = vi.fn().mockResolvedValue({
      entries: new Map(),
      parentCommitOid: 'commit-1',
      metadata: { version: 1, encryption: { kdf: { algorithm: 'pbkdf2' } } },
    });
    const deps = makeDeps({
      cas: {
        getVaultService: vi.fn().mockResolvedValue({ readState }),
        readManifest: vi.fn(),
      },
    });
    const app = createDashboardApp(deps);

    const [next, cmds] = app.update(
      { type: 'key', key: 'x' },
      makeModel({ workspace: 'operations', vaultEncryptionKey: encryptionKey })
    );
    const message = await cmds[0]();

    expect(next.doctorStatus).toBe('loading');
    expect(message.type).toBe('loaded-doctor');
    expect(readState).toHaveBeenCalledWith({ encryptionKey });
  });
});

describe('dashboard store wizard command', () => {
  it('threads the store wizard encryption, compression, and chunking plan into storeFile', async () => {
    const manifest = { slug: 'secure/app', chunks: [] };
    const storeFile = vi.fn().mockResolvedValue(manifest);
    const createTree = vi.fn().mockResolvedValue('f'.repeat(40));
    const addToVault = vi.fn().mockResolvedValue({ commitOid: 'c'.repeat(40) });
    const deps = makeDeps({ cas: { storeFile, createTree, addToVault } });
    const app = createDashboardApp(deps);
    const model = makeModel({
      workspace: 'operations',
      storeWizard: {
        step: 'confirm',
        filePath: './secure.bin',
        slug: 'secure/app',
        encryption: 'convergent',
        passphrase: 'correct horse battery staple',
        passphraseVisible: false,
        compression: true,
        chunking: 'cdc',
        selectIndex: 0,
        error: null,
        resultSlug: null,
      },
    });

    const [pending, cmds] = app.update({ type: 'key', key: 'enter' }, model);
    const message = await cmds[0]();

    expect(pending.storeWizard.step).toBe('storing');
    expect(message.type).toBe('store-complete');
    expect(storeFile).toHaveBeenCalledWith({
      filePath: './secure.bin',
      slug: 'secure/app',
      passphrase: 'correct horse battery staple',
      encryption: { scheme: 'convergent' },
      compression: { algorithm: 'gzip' },
      chunking: { strategy: 'cdc' },
    });
    expect(createTree).toHaveBeenCalledWith({ manifest });
    expect(addToVault).toHaveBeenCalledWith({
      slug: 'secure/app',
      treeOid: 'f'.repeat(40),
      force: true,
    });
  });
});
