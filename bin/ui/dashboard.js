/**
 * TEA app shell for the V6 git-cas cockpit.
 */

import { startApp as bijouStartApp } from '@flyingrobots/bijou-node';
import {
  cpFilter,
  cpFocusNext,
  cpFocusPrev,
  cpPageDown,
  cpPageUp,
  cpSelectedItem,
  createCommandPaletteState,
  createNavigableTableState,
  createNotificationState,
  navTableFocusNext,
  navTableFocusPrev,
  navTablePageDown,
  navTablePageUp,
  notificationsNeedTick,
  pushNotification,
  quit,
  tick as bijouTick,
  tickNotifications,
} from '@flyingrobots/bijou-tui';
import { renderDashboard, tableSchema } from './dashboard-view.js';
import { createCliTuiContext } from './context.js';
import { formatTabSeparated } from './vault-list.js';
import {
  loadBranchCmd,
  loadDoctorCmd,
  loadEntriesCmd,
  loadManifestCmd,
  loadRefsCmd,
  loadStatsCmd,
  loadTreemapCmd,
  readSourceEntries,
} from './dashboard-cmds.js';
import { createWizardState, wizardHandleKey } from './store-wizard.js';
import { createFeedState } from './blocks/operation-feed.js';

/** @typedef {import('../index.js').default} ContentAddressableStore */
/** @typedef {import('../src/domain/value-objects/Manifest.js').default} Manifest */
/** @typedef {import('../src/domain/services/VaultService.js').VaultEntry} VaultEntry */
/** @typedef {import('@flyingrobots/bijou').BijouContext} BijouContext */
/** @typedef {import('@flyingrobots/bijou-tui').CommandPaletteState} CommandPaletteState */
/** @typedef {import('@flyingrobots/bijou-tui').NavigableTableState} NavigableTableState */
/** @typedef {import('@flyingrobots/bijou-tui').NotificationState} NotificationState */
/** @typedef {import('./store-wizard.js').StoreWizardState} StoreWizardState */
/** @typedef {import('./blocks/operation-feed.js').OperationFeedState} OperationFeedState */

/**
 * @typedef {'title' | 'password' | 'dashboard'} AppPhase
 * @typedef {'explorer' | 'atlas' | 'operations'} WorkspaceId
 * @typedef {'ledger' | 'manifest' | 'merkle'} ExplorerMode
 * @typedef {'table' | 'tree' | 'dag'} MerkleMode
 * @typedef {{ type: 'vault' } | { type: 'ref', ref: string } | { type: 'oid', treeOid: string }} DashSource
 */

/**
 * @typedef {Object} DashModel
 * @property {AppPhase} phase
 * @property {number} titleTimeMs
 * @property {number} lastTickTime
 * @property {number} fps
 * @property {boolean} showPerfHud
 * @property {number} vaultEntryCount
 * @property {string} passphrase
 * @property {string | null} authError
 * @property {string} status
 * @property {number} columns
 * @property {number} rows
 * @property {DashSource} source
 * @property {WorkspaceId} workspace
 * @property {ExplorerMode} explorerMode
 * @property {MerkleMode} merkleMode
 * @property {VaultEntry[]} entries
 * @property {VaultEntry[]} filtered
 * @property {string} filterText
 * @property {boolean} filtering
 * @property {any} metadata
 * @property {Map<string, Manifest>} manifestCache
 * @property {string | null} loadingSlug
 * @property {string | null} error
 * @property {NavigableTableState} table
 * @property {CommandPaletteState | null} palette
 * @property {boolean} showHelp
 * @property {boolean} promptEnter
 * @property {boolean} quitConfirm
 * @property {any} refsStatus
 * @property {any | null} refsInventory
 * @property {string | null} refsError
 * @property {any} statsStatus
 * @property {any | null} statsReport
 * @property {string | null} statsError
 * @property {any} doctorStatus
 * @property {any | null} doctorReport
 * @property {string | null} doctorError
 * @property {any} treemapScope
 * @property {any} treemapWorktreeMode
 * @property {any[]} treemapPath
 * @property {number} treemapFocus
 * @property {any} treemapStatus
 * @property {any | null} treemapReport
 * @property {string | null} treemapError
 * @property {NotificationState} notifications
 * @property {OperationFeedState} operationFeed
 * @property {StoreWizardState | null} storeWizard
 * @property {string | null} gitBranch
 */

/**
 * @typedef {Object} DashDeps
 * @property {ContentAddressableStore} cas
 * @property {BijouContext} ctx
 * @property {string} cwdLabel
 * @property {DashSource} source
 * @property {(ms: number, msg: any) => any} tick
 */

const TITLE_TICK_MS = 33;
const NOTIFICATION_TICK_MS = 40;

const FULL_COLUMNS = [
  { header: 'Slug' },
  { header: 'Tree OID' },
  { header: 'Size' },
  { header: 'Chunks' },
  { header: 'Crypto' },
  { header: 'Format' },
  { header: 'State' },
];

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) { return '-'; }
  if (bytes < 1024) { return `${bytes}B`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)}K`; }
  if (bytes < 1024 * 1024 * 1024) { return `${(bytes / (1024 * 1024)).toFixed(1)}M`; }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

function shortOid(oid) {
  return typeof oid === 'string' ? oid.slice(0, 12) : '-';
}

function manifestData(manifest) {
  return manifest?.toJSON ? manifest.toJSON() : manifest;
}

function manifestFor(entry, manifestCache) {
  return entry ? manifestData(manifestCache.get(entry.slug)) : null;
}

function cryptoLabel(manifest) {
  if (!manifest) { return '-'; }
  if (manifest.encryption?.encrypted || manifest.encryption?.recipients?.length || manifest.encryption) {
    return 'encrypted';
  }
  return 'plain';
}

function formatLabel(manifest) {
  if (!manifest) { return '-'; }
  return manifest.formatVersion ?? (manifest.version ? `v${manifest.version}` : 'manifest');
}

function chunkLabel(manifest) {
  if (!manifest) { return '-'; }
  const chunks = manifest.chunks?.length ?? 0;
  const subManifests = manifest.subManifests?.length ?? 0;
  return subManifests > 0 ? `${chunks}+${subManifests}` : String(chunks);
}

function rowForEntry(entry, manifestCache) {
  const manifest = manifestFor(entry, manifestCache);
  return [
    entry.slug,
    shortOid(entry.treeOid),
    formatSize(manifest?.size),
    chunkLabel(manifest),
    cryptoLabel(manifest),
    formatLabel(manifest),
    manifest ? 'loaded' : 'pending',
  ];
}

function buildTableRows(entries, manifestCache) {
  return entries.map((entry) => rowForEntry(entry, manifestCache));
}

function tableHeight(rows) {
  return Math.max(4, Math.min(18, Math.max(1, rows - 10)));
}

function sourceEquals(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function filterEntries(entries, filterText, manifestCache) {
  const query = filterText.trim().toLowerCase();
  if (!query) { return entries; }
  return entries.filter((entry) => {
    const manifest = manifestFor(entry, manifestCache);
    const haystack = [
      entry.slug,
      entry.treeOid,
      manifest?.integrity,
      manifest?.hash,
      ...(manifest?.chunks ?? []).flatMap((chunk) => [chunk.digest, chunk.blob]),
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(query);
  });
}

function syncExplorer(model, patch = {}) {
  const next = { ...model, ...patch };
  const filtered = filterEntries(next.entries, next.filterText, next.manifestCache);
  const table = createNavigableTableState({
    columns: FULL_COLUMNS,
    rows: buildTableRows(filtered, next.manifestCache),
    height: tableHeight(next.rows),
    focusRow: Math.min(next.table?.focusRow ?? 0, Math.max(0, filtered.length - 1)),
    scrollY: next.table?.scrollY ?? 0,
  });
  return { ...next, filtered, table };
}

function selectedEntry(model) {
  return model.filtered[Math.min(model.table.focusRow, Math.max(0, model.filtered.length - 1))] ?? null;
}

function selectedManifest(model) {
  return manifestFor(selectedEntry(model), model.manifestCache);
}

function maybeLoadSelectedManifest(model, deps) {
  const entry = selectedEntry(model);
  if (!entry || model.manifestCache.has(entry.slug) || model.loadingSlug === entry.slug) {
    return null;
  }
  return loadManifestCmd(deps.cas, { slug: entry.slug, treeOid: entry.treeOid, source: model.source });
}

function createShellState(columns, rows, source) {
  return {
    phase: 'title',
    titleTimeMs: 0,
    lastTickTime: 0,
    fps: 0,
    showPerfHud: false,
    vaultEntryCount: 0,
    passphrase: '',
    authError: null,
    status: 'checking vault',
    columns,
    rows,
    source,
    workspace: 'explorer',
    explorerMode: 'ledger',
    merkleMode: 'table',
    promptEnter: false,
    quitConfirm: false,
    gitBranch: null,
  };
}

function createExplorerState(rows) {
  return {
    entries: [],
    filtered: [],
    filterText: '',
    filtering: false,
    metadata: null,
    manifestCache: new Map(),
    loadingSlug: null,
    error: null,
    table: createNavigableTableState({ columns: FULL_COLUMNS, rows: [], height: tableHeight(rows) }),
    palette: null,
    showHelp: false,
  };
}

function createServiceState() {
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
    storeWizard: null,
  };
}

function createInitModel(ctx, source) {
  const rows = ctx.runtime.rows ?? 24;
  const columns = ctx.runtime.columns ?? 80;
  return syncExplorer({
    ...createShellState(columns, rows, source),
    ...createExplorerState(rows),
    ...createServiceState(),
  });
}

function checkVaultAuthCmd(cas) {
  return async () => {
    try {
      const metadata = await cas.getVaultMetadata();
      const all = await cas.listVault();
      return { type: 'vault-auth-check', encrypted: Boolean(metadata?.encryption), entryCount: all.length, metadata };
    } catch {
      return { type: 'vault-auth-check', encrypted: false, entryCount: 0, metadata: null };
    }
  };
}

function verifyPassphraseCmd(cas, passphrase) {
  return async () => {
    try {
      const entries = await cas.listVault();
      if (entries.length === 0) { return { type: 'vault-auth-ok' }; }
      const manifest = await cas.readManifest({ treeOid: entries[0].treeOid });
      const ok = await cas.verifyIntegrity(manifest, { passphrase });
      return ok ? { type: 'vault-auth-ok' } : { type: 'vault-auth-fail', error: 'Wrong passphrase' };
    } catch (err) {
      const authErrorCodes = ['INTEGRITY_ERROR', 'DEK_UNWRAP_FAILED', 'MISSING_KEY', 'NO_MATCHING_RECIPIENT'];
      const msg = authErrorCodes.includes(err.code) ? 'Wrong passphrase' : (err.message ?? String(err));
      return { type: 'vault-auth-fail', error: msg };
    }
  };
}

function runStoreWizardCmd(cas, wizard) {
  return async () => {
    try {
      if (wizard.encryption !== 'none') {
        return {
          type: 'store-error',
          error: 'The TUI store path currently supports plaintext store plans only. Use the CLI for passphrase or convergent encryption.',
        };
      }
      const manifest = await cas.storeFile({
        filePath: wizard.filePath,
        slug: wizard.slug,
        ...(wizard.compression ? { compression: { algorithm: 'gzip' } } : {}),
      });
      const treeOid = await cas.createTree({ manifest });
      await cas.addToVault({ slug: wizard.slug, treeOid, force: true });
      return { type: 'store-complete', slug: wizard.slug, treeOid, manifest };
    } catch (err) {
      return { type: 'store-error', error: err.message ?? String(err) };
    }
  };
}

function enterDashboard(model, deps) {
  return [{
    ...model,
    phase: 'dashboard',
    promptEnter: false,
    authError: null,
    status: 'loading entries',
  }, [
    loadEntriesCmd(deps.cas, model.source),
    loadBranchCmd(deps.cas),
    loadRefsCmd(deps.cas),
  ]];
}

function pushToast(model, spec) {
  return {
    ...model,
    notifications: pushNotification(model.notifications, {
      variant: 'TOAST',
      placement: 'LOWER_RIGHT',
      width: 42,
      ...spec,
    }, Date.now()),
  };
}

function notificationTick(model, deps) {
  return notificationsNeedTick(model.notifications)
    ? [deps.tick(NOTIFICATION_TICK_MS, { type: 'notification-tick' })]
    : [];
}

function handleTickMsg(msg, model, deps) {
  if (msg.type === 'notification-tick') {
    const next = { ...model, notifications: tickNotifications(model.notifications, Date.now()) };
    return [next, notificationTick(next, deps)];
  }
  if (msg.type !== 'title-tick' || (model.phase !== 'title' && model.phase !== 'password')) {
    return [model, []];
  }
  const now = Date.now();
  const elapsed = now - (model.lastTickTime || now);
  const fps = elapsed > 0 ? Math.round(1000 / elapsed) : 0;
  return [{
    ...model,
    titleTimeMs: (model.titleTimeMs || 0) + TITLE_TICK_MS,
    lastTickTime: now,
    fps: model.lastTickTime ? fps : 0,
  }, [deps.tick(TITLE_TICK_MS, { type: 'title-tick' })]];
}

function handleVaultAuthCheck(msg, model) {
  if (msg.encrypted) {
    return [{
      ...model,
      phase: 'password',
      metadata: msg.metadata,
      vaultEntryCount: msg.entryCount,
      status: 'vault locked',
    }, []];
  }
  return [{
    ...model,
    metadata: msg.metadata,
    promptEnter: true,
    vaultEntryCount: msg.entryCount,
    status: 'vault ready',
  }, []];
}

function handleLoadedEntries(msg, model, deps) {
  if (!sourceEquals(msg.source, model.source)) { return [model, []]; }
  const next = syncExplorer(model, {
    entries: msg.entries,
    metadata: msg.metadata,
    status: `${msg.entries.length} entries`,
    error: null,
  });
  const manifestCmd = maybeLoadSelectedManifest(next, deps);
  return [next, [
    loadStatsCmd(deps.cas, msg.entries, model.source),
    ...(manifestCmd ? [manifestCmd] : []),
  ]];
}

function handleLoadedManifest(msg, model) {
  if (!sourceEquals(msg.source, model.source)) { return [model, []]; }
  const manifestCache = new Map(model.manifestCache);
  manifestCache.set(msg.slug, msg.manifest);
  return [syncExplorer(model, { manifestCache, loadingSlug: null }), []];
}

function handleLoadError(msg, model) {
  let next = model;
  const error = msg.error ?? 'Unknown dashboard error';
  if (msg.source === 'entries') {
    next = { ...next, status: 'entry load failed', error };
  } else if (msg.source === 'manifest') {
    next = { ...next, loadingSlug: null, error };
  } else if (msg.source === 'refs') {
    next = { ...next, refsStatus: 'error', refsError: error };
  } else if (msg.source === 'stats') {
    next = { ...next, statsStatus: 'error', statsError: error };
  } else if (msg.source === 'doctor') {
    next = { ...next, doctorStatus: 'error', doctorError: error };
  } else if (msg.source === 'treemap') {
    next = { ...next, treemapStatus: 'error', treemapError: error };
  }
  return [pushToast(next, { title: 'Dashboard load failed', message: error, tone: 'ERROR' }), []];
}

function handleAuthOkMsg(_msg, model, deps) {
  return enterDashboard(model, deps);
}

function handleAuthFailMsg(msg, model) {
  return [{ ...model, authError: msg.error, passphrase: '' }, []];
}

function handleLoadedRefsMsg(msg, model) {
  return [{ ...model, refsStatus: 'ready', refsInventory: msg.refs, refsError: null }, []];
}

function handleLoadedStatsMsg(msg, model) {
  if (!sourceEquals(msg.source, model.source)) { return [model, []]; }
  return [{ ...model, statsStatus: 'ready', statsReport: msg.stats, statsError: null }, []];
}

function handleLoadedDoctorMsg(msg, model) {
  if (!sourceEquals(msg.source, model.source)) { return [model, []]; }
  return [{ ...model, doctorStatus: 'ready', doctorReport: msg.report, doctorError: null }, []];
}

function handleLoadedTreemapMsg(msg, model) {
  return [{ ...model, treemapStatus: 'ready', treemapReport: msg.report, treemapFocus: 0, treemapError: null }, []];
}

function handleLoadedBranchMsg(msg, model) {
  return [{ ...model, gitBranch: msg.branch }, []];
}

function handleStoreCompleteMsg(msg, model, deps) {
  const manifestCache = new Map(model.manifestCache);
  manifestCache.set(msg.slug, msg.manifest);
  const next = pushToast({
    ...syncExplorer(model, { manifestCache, storeWizard: null }),
    operationFeed: completeLatestOperation(model.operationFeed, msg.slug, null),
  }, { title: 'Stored asset', message: `${msg.slug} -> ${shortOid(msg.treeOid)}`, tone: 'SUCCESS' });
  return [next, [loadEntriesCmd(deps.cas, model.source), ...notificationTick(next, deps)]];
}

function handleStoreErrorMsg(msg, model, deps) {
  const next = pushToast({
    ...model,
    storeWizard: model.storeWizard ? { ...model.storeWizard, step: 'error', error: msg.error } : null,
    operationFeed: completeLatestOperation(model.operationFeed, model.storeWizard?.slug ?? 'store', msg.error),
  }, { title: 'Store failed', message: msg.error, tone: 'ERROR' });
  return [next, notificationTick(next, deps)];
}

const APP_MSG_HANDLERS = {
  'notification-tick': handleTickMsg,
  'title-tick': handleTickMsg,
  'vault-auth-check': handleVaultAuthCheck,
  'vault-auth-ok': handleAuthOkMsg,
  'vault-auth-fail': handleAuthFailMsg,
  'loaded-entries': handleLoadedEntries,
  'loaded-manifest': handleLoadedManifest,
  'loaded-refs': handleLoadedRefsMsg,
  'loaded-stats': handleLoadedStatsMsg,
  'loaded-doctor': handleLoadedDoctorMsg,
  'loaded-treemap': handleLoadedTreemapMsg,
  'loaded-branch': handleLoadedBranchMsg,
  'store-complete': handleStoreCompleteMsg,
  'store-error': handleStoreErrorMsg,
  'load-error': handleLoadError,
};

function handleAppMsg(msg, model, deps) {
  const handler = APP_MSG_HANDLERS[msg.type];
  return handler ? handler(msg, model, deps) : [model, []];
}

function handleTitleKey(msg, model, deps) {
  if (msg.key === '`') { return [{ ...model, showPerfHud: !model.showPerfHud }, []]; }
  if (msg.key === 'q' || msg.key === 'escape') { return [model, [quit()]]; }
  if (msg.key === 'enter' && model.promptEnter) { return enterDashboard(model, deps); }
  return [model, []];
}

function handlePasswordKey(msg, model, deps) {
  if (msg.key === '`') { return [{ ...model, showPerfHud: !model.showPerfHud }, []]; }
  if (msg.key === 'escape') { return [model, [quit()]]; }
  if (msg.key === 'enter') {
    return [{ ...model, authError: null }, [verifyPassphraseCmd(deps.cas, model.passphrase)]];
  }
  if (msg.key === 'backspace') {
    return [{ ...model, passphrase: model.passphrase.slice(0, -1) }, []];
  }
  if (msg.key.length === 1) {
    return [{ ...model, passphrase: model.passphrase + msg.key }, []];
  }
  return [model, []];
}

function buildPaletteItems(model) {
  return model.entries.map((entry) => {
    const manifest = manifestFor(entry, model.manifestCache);
    const digests = (manifest?.chunks ?? [])
      .slice(0, 4)
      .flatMap((chunk) => [chunk.digest, chunk.blob])
      .filter(Boolean)
      .join(' ');
    return {
      id: entry.slug,
      label: entry.slug,
      category: 'asset',
      description: `${entry.treeOid} ${manifest?.integrity ?? ''} ${digests}`.trim(),
      shortcut: 'enter',
    };
  });
}

function openPalette(model) {
  return {
    ...model,
    palette: createCommandPaletteState(buildPaletteItems(model), 9),
    showHelp: false,
  };
}

function selectPaletteItem(model, deps) {
  const item = cpSelectedItem(model.palette);
  if (!item) { return [{ ...model, palette: null }, []]; }
  const selected = model.entries.find((entry) => entry.slug === item.id);
  const next = syncExplorer(model, {
    workspace: 'explorer',
    explorerMode: 'manifest',
    palette: null,
    filterText: selected ? selected.slug : model.filterText,
    filtering: false,
  });
  const manifestCmd = maybeLoadSelectedManifest(next, deps);
  return [next, manifestCmd ? [manifestCmd] : []];
}

const PALETTE_ACTIONS = {
  close: (_msg, model) => [{ ...model, palette: null }, []],
  select: (_msg, model, deps) => selectPaletteItem(model, deps),
  next: (_msg, model) => [{ ...model, palette: cpFocusNext(model.palette) }, []],
  previous: (_msg, model) => [{ ...model, palette: cpFocusPrev(model.palette) }, []],
  pageDown: (_msg, model) => [{ ...model, palette: cpPageDown(model.palette) }, []],
  pageUp: (_msg, model) => [{ ...model, palette: cpPageUp(model.palette) }, []],
};

const PALETTE_KEY_ACTIONS = {
  escape: 'close',
  enter: 'select',
  down: 'next',
  up: 'previous',
  pagedown: 'pageDown',
  pageup: 'pageUp',
};

function paletteAction(msg) {
  if (msg.ctrl && msg.key === 'n') { return 'next'; }
  if (msg.ctrl && msg.key === 'p') { return 'previous'; }
  if (msg.ctrl && msg.key === 'd') { return 'pageDown'; }
  if (msg.ctrl && msg.key === 'u') { return 'pageUp'; }
  return PALETTE_KEY_ACTIONS[msg.key] ?? null;
}

function paletteQueryForKey(msg, palette) {
  if (msg.key === 'backspace') { return palette.query.slice(0, -1); }
  if (msg.key.length === 1 && !msg.ctrl && !msg.alt) { return `${palette.query}${msg.key}`; }
  return null;
}

function handlePaletteKey(msg, model, deps) {
  if (!model.palette) { return [model, []]; }
  const action = paletteAction(msg);
  if (action) { return PALETTE_ACTIONS[action](msg, model, deps); }
  const query = paletteQueryForKey(msg, model.palette);
  return query === null
    ? [model, []]
    : [{ ...model, palette: cpFilter(model.palette, query) }, []];
}

function handleFilterKey(msg, model) {
  if (msg.key === 'escape') { return [syncExplorer(model, { filtering: false }), []]; }
  if (msg.key === 'enter') { return [syncExplorer(model, { filtering: false }), []]; }
  if (msg.key === 'backspace') {
    return [syncExplorer(model, { filterText: model.filterText.slice(0, -1) }), []];
  }
  if (msg.key.length === 1 && !msg.ctrl && !msg.alt) {
    return [syncExplorer(model, { filterText: `${model.filterText}${msg.key}` }), []];
  }
  return [model, []];
}

function handleExplorerNavigation(msg, model, deps) {
  let table = model.table;
  if (msg.key === 'j' || msg.key === 'down') { table = navTableFocusNext(table); }
  else if (msg.key === 'k' || msg.key === 'up') { table = navTableFocusPrev(table); }
  else if (msg.key === 'd' || msg.key === 'pagedown') { table = navTablePageDown(table); }
  else if (msg.key === 'u' || msg.key === 'pageup') { table = navTablePageUp(table); }
  else { return null; }
  const next = { ...model, table };
  const manifestCmd = maybeLoadSelectedManifest(next, deps);
  return [next, manifestCmd ? [manifestCmd] : []];
}

function switchWorkspace(model, workspace, deps) {
  const next = { ...model, workspace, showHelp: false };
  if (workspace === 'atlas' && next.treemapStatus === 'idle') {
    return [{ ...next, treemapStatus: 'loading' }, [loadTreemapCmd(deps.cas, {
      source: next.source,
      scope: next.treemapScope,
      worktreeMode: next.treemapWorktreeMode,
      drillPath: next.treemapPath,
    })]];
  }
  if (workspace === 'operations' && next.statsStatus === 'idle') {
    return [{ ...next, statsStatus: 'loading' }, [loadStatsCmd(deps.cas, next.entries, next.source)]];
  }
  return [next, []];
}

function handleWorkspaceKey(msg, model, deps) {
  if (msg.key === '1' || msg.key === 'e') { return switchWorkspace(model, 'explorer', deps); }
  if (msg.key === '2' || msg.key === 'a') { return switchWorkspace(model, 'atlas', deps); }
  if (msg.key === '3' || msg.key === 'o') { return switchWorkspace(model, 'operations', deps); }
  return null;
}

function handleExplorerKey(msg, model, deps) {
  const nav = handleExplorerNavigation(msg, model, deps);
  if (nav) { return nav; }
  if (msg.key === 'enter') {
    const next = { ...model, explorerMode: model.explorerMode === 'ledger' ? 'manifest' : 'ledger' };
    const manifestCmd = maybeLoadSelectedManifest(next, deps);
    return [next, manifestCmd ? [manifestCmd] : []];
  }
  if (msg.key === 'm') {
    const modes = /** @type {MerkleMode[]} */ (['table', 'tree', 'dag']);
    const nextMode = modes[(modes.indexOf(model.merkleMode) + 1) % modes.length];
    return [{ ...model, explorerMode: 'merkle', merkleMode: nextMode }, []];
  }
  if (msg.key === 'i') {
    const next = { ...model, explorerMode: model.explorerMode === 'manifest' ? 'merkle' : 'manifest' };
    const manifestCmd = maybeLoadSelectedManifest(next, deps);
    return [next, manifestCmd ? [manifestCmd] : []];
  }
  return null;
}

function reloadTreemap(model, deps, patch = {}) {
  const next = { ...model, ...patch, treemapStatus: 'loading', treemapError: null };
  return [next, [loadTreemapCmd(deps.cas, {
    source: next.source,
    scope: next.treemapScope,
    worktreeMode: next.treemapWorktreeMode,
    drillPath: next.treemapPath,
  })]];
}

function focusAtlasTile(model, delta) {
  const tiles = model.treemapReport?.tiles ?? [];
  const maxFocus = Math.max(0, tiles.length - 1);
  return [{ ...model, treemapFocus: Math.max(0, Math.min(model.treemapFocus + delta, maxFocus)) }, []];
}

function drillIntoAtlasTile(model, deps) {
  const tile = model.treemapReport?.tiles?.[model.treemapFocus];
  return tile?.drillable && tile.path
    ? reloadTreemap(model, deps, { treemapPath: [...model.treemapPath, tile.path] })
    : null;
}

function drillOutAtlasTile(model, deps) {
  return model.treemapPath.length > 0
    ? reloadTreemap(model, deps, { treemapPath: model.treemapPath.slice(0, -1) })
    : null;
}

const ATLAS_KEY_ACTIONS = {
  j: 'next',
  down: 'next',
  k: 'previous',
  up: 'previous',
  t: 'scope',
  i: 'worktreeMode',
  r: 'reload',
  '+': 'drillIn',
  enter: 'drillIn',
  '-': 'drillOut',
  backspace: 'drillOut',
};

const ATLAS_ACTIONS = {
  next: (_msg, model) => focusAtlasTile(model, 1),
  previous: (_msg, model) => focusAtlasTile(model, -1),
  scope: (_msg, model, deps) => reloadTreemap(model, deps, { treemapScope: model.treemapScope === 'repository' ? 'source' : 'repository', treemapPath: [] }),
  worktreeMode: (_msg, model, deps) => reloadTreemap(model, deps, { treemapWorktreeMode: model.treemapWorktreeMode === 'tracked' ? 'ignored' : 'tracked', treemapPath: [] }),
  reload: (_msg, model, deps) => reloadTreemap(model, deps),
  drillIn: (_msg, model, deps) => drillIntoAtlasTile(model, deps),
  drillOut: (_msg, model, deps) => drillOutAtlasTile(model, deps),
};

function handleAtlasKey(msg, model, deps) {
  const action = ATLAS_KEY_ACTIONS[msg.key];
  return action ? ATLAS_ACTIONS[action](msg, model, deps) : null;
}

function startOperation(operationFeed, slug) {
  return {
    ...operationFeed,
    entries: [{
      id: `store-${slug}-${Date.now()}`,
      type: 'store',
      slug,
      status: 'running',
      startTime: Date.now(),
      endTime: null,
      chunksTotal: 0,
      chunksProcessed: 0,
      error: null,
    }, ...operationFeed.entries].slice(0, operationFeed.maxEntries),
  };
}

function completeLatestOperation(operationFeed, slug, error) {
  return {
    ...operationFeed,
    entries: operationFeed.entries.map((entry, index) => {
      if (index !== 0 || entry.slug !== slug) { return entry; }
      return {
        ...entry,
        status: error ? 'error' : 'done',
        endTime: Date.now(),
        error,
      };
    }),
  };
}

function handleWizardKey(msg, model, deps) {
  if (!model.storeWizard) { return null; }
  if (msg.key === 'escape') {
    return [{ ...model, storeWizard: null }, []];
  }
  const nextWizard = wizardHandleKey(model.storeWizard, msg.key);
  if (nextWizard.step === 'storing') {
    return [{
      ...model,
      storeWizard: nextWizard,
      operationFeed: startOperation(model.operationFeed, nextWizard.slug),
    }, [runStoreWizardCmd(deps.cas, nextWizard)]];
  }
  return [{ ...model, storeWizard: nextWizard }, []];
}

function handleOperationsKey(msg, model, deps) {
  if (msg.key === 'n') { return [{ ...model, storeWizard: createWizardState() }, []]; }
  if (msg.key === 's') {
    return [{ ...model, statsStatus: 'loading', statsError: null }, [loadStatsCmd(deps.cas, model.entries, model.source)]];
  }
  if (msg.key === 'x') {
    return [{ ...model, doctorStatus: 'loading', doctorError: null }, [loadDoctorCmd(deps.cas, model.source, model.entries)]];
  }
  return null;
}

function handleQuitConfirmKey(msg, model) {
  if (msg.key === 'y' || msg.key === 'enter') { return [model, [quit()]]; }
  if (msg.key === 'n' || msg.key === 'escape' || msg.key === 'q') {
    return [{ ...model, quitConfirm: false }, []];
  }
  return [model, []];
}

function clearDashboardOverlays(model) {
  return { ...model, showHelp: false, storeWizard: null, palette: null, filtering: false, quitConfirm: false };
}

function handleOverlayShortcut(msg, model) {
  if (msg.key === 'escape') { return [clearDashboardOverlays(model), []]; }
  if (msg.key === '?' || (msg.shift && msg.key === '/')) {
    return [{ ...model, showHelp: !model.showHelp, palette: null }, []];
  }
  if (msg.key === 'q') { return [{ ...model, quitConfirm: true }, []]; }
  return null;
}

function handleSearchShortcut(msg, model) {
  if (msg.key === '/' && !msg.ctrl) {
    return [syncExplorer(model, { workspace: 'explorer', filtering: true, palette: null }), []];
  }
  if ((msg.ctrl && msg.key === 'p') || msg.key === ':') { return [openPalette(model), []]; }
  return null;
}

function handleGlobalDashboardKey(msg, model, deps) {
  const overlay = handleOverlayShortcut(msg, model);
  if (overlay) { return overlay; }
  const search = handleSearchShortcut(msg, model);
  if (search) { return search; }
  return handleWorkspaceKey(msg, model, deps);
}

const WORKSPACE_KEY_HANDLERS = {
  explorer: handleExplorerKey,
  atlas: handleAtlasKey,
  operations: handleOperationsKey,
};

function handleWorkspaceSpecificKey(msg, model, deps) {
  const handler = WORKSPACE_KEY_HANDLERS[model.workspace];
  return handler ? handler(msg, model, deps) : null;
}

function handleDashboardKey(msg, model, deps) {
  if (model.quitConfirm) { return handleQuitConfirmKey(msg, model); }
  if (model.palette) { return handlePaletteKey(msg, model, deps); }
  const wizard = handleWizardKey(msg, model, deps);
  if (wizard) { return wizard; }
  if (model.filtering) { return handleFilterKey(msg, model); }
  const global = handleGlobalDashboardKey(msg, model, deps);
  return global ?? handleWorkspaceSpecificKey(msg, model, deps) ?? [model, []];
}

function handleUpdate(msg, model, deps) {
  if (msg.type === 'key') {
    if (model.phase === 'title') { return handleTitleKey(msg, model, deps); }
    if (model.phase === 'password') { return handlePasswordKey(msg, model, deps); }
    return handleDashboardKey(msg, model, deps);
  }
  if (msg.type === 'resize') {
    return [syncExplorer(model, { columns: msg.columns, rows: msg.rows }), []];
  }
  return handleAppMsg(msg, model, deps);
}

export function createDashboardApp(deps) {
  return {
    init: () => [createInitModel(deps.ctx, deps.source), [
      checkVaultAuthCmd(deps.cas),
      deps.tick(TITLE_TICK_MS, { type: 'title-tick' }),
    ]],
    update: (msg, model) => handleUpdate(msg, model, deps),
    view: (model) => renderDashboard(model, deps),
  };
}

async function printStaticList(cas, source, output) {
  const { entries } = await readSourceEntries(cas, source);
  output.write(formatTabSeparated(entries));
}

function normalizeLaunchContext(ctx) {
  if (!ctx.mode && !ctx.runtime) {
    throw new Error('launchDashboard requires ctx.runtime when ctx.mode is absent');
  }
  return ctx;
}

export async function launchDashboard(cas, options = {}) {
  const ctx = options.ctx ? normalizeLaunchContext(options.ctx) : createCliTuiContext();
  const source = options.source ?? { type: 'vault' };
  if (ctx.mode !== 'interactive') {
    return printStaticList(cas, source, options.output || process.stdout);
  }
  const dashTick = options.tick || bijouTick;
  const deps = { cas, ctx, cwdLabel: options.cwd ?? process.cwd(), source, tick: dashTick };
  const runApp = options.runApp || bijouStartApp;
  return runApp(createDashboardApp(deps), { ctx });
}

export { buildTableRows, selectedEntry, selectedManifest, tableSchema };
export default launchDashboard;
