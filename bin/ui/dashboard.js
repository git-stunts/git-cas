/**
 * TEA app shell for the V6 git-cas cockpit.
 */

import {
  createFramedApp,
  createKeyMap,
  createNavigableTableState,
  navTableFocusNext,
  navTableFocusPrev,
  navTablePageDown,
  navTablePageUp,
  notify,
  tick as bijouTick,
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
import { shortenSha } from './components/short-sha.js';

/** @typedef {import('../index.js').default} ContentAddressableStore */
/** @typedef {import('../src/domain/value-objects/Manifest.js').default} Manifest */
/** @typedef {import('../src/domain/services/VaultService.js').VaultEntry} VaultEntry */
/** @typedef {import('@flyingrobots/bijou').BijouContext} BijouContext */
/** @typedef {import('@flyingrobots/bijou-tui').NavigableTableState} NavigableTableState */
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
 * @property {'ledger' | 'detail'} focusPane
 * @property {number} chunkFocus
 * @property {VaultEntry[]} entries
 * @property {VaultEntry[]} filtered
 * @property {string} filterText
 * @property {any} metadata
 * @property {Map<string, Manifest>} manifestCache
 * @property {string | null} loadingSlug
 * @property {string | null} error
 * @property {NavigableTableState} table
 * @property {boolean} promptEnter
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
 * @property {OperationFeedState} operationFeed
 * @property {StoreWizardState | null} storeWizard
 * @property {string | null} gitBranch
 * @property {Buffer | null} vaultEncryptionKey
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
  if (!Number.isFinite(bytes)) {
    return '-';
  }
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}K`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

function manifestData(manifest) {
  return manifest?.toJSON ? manifest.toJSON() : manifest;
}

function manifestFor(entry, manifestCache) {
  return entry ? manifestData(manifestCache.get(entry.slug)) : null;
}

function cryptoLabel(manifest) {
  if (!manifest) {
    return '-';
  }
  if (
    manifest.encryption?.encrypted ||
    manifest.encryption?.recipients?.length ||
    manifest.encryption
  ) {
    return 'encrypted';
  }
  return 'plain';
}

function formatLabel(manifest) {
  if (!manifest) {
    return '-';
  }
  return manifest.formatVersion ?? (manifest.version ? `v${manifest.version}` : 'manifest');
}

function chunkLabel(manifest) {
  if (!manifest) {
    return '-';
  }
  const chunks = manifest.chunks?.length ?? 0;
  const subManifests = manifest.subManifests?.length ?? 0;
  return subManifests > 0 ? `${chunks}+${subManifests}` : String(chunks);
}

function rowForEntry(entry, manifestCache) {
  const manifest = manifestFor(entry, manifestCache);
  return [
    entry.slug,
    shortenSha(entry.treeOid),
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
  if (!query) {
    return entries;
  }
  return entries.filter((entry) => {
    const manifest = manifestFor(entry, manifestCache);
    const haystack = [
      entry.slug,
      entry.treeOid,
      manifest?.integrity,
      manifest?.hash,
      ...(manifest?.chunks ?? []).flatMap((chunk) => [chunk.digest, chunk.blob]),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
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
  return (
    model.filtered[Math.min(model.table.focusRow, Math.max(0, model.filtered.length - 1))] ?? null
  );
}

function selectedManifest(model) {
  return manifestFor(selectedEntry(model), model.manifestCache);
}

function maybeLoadSelectedManifest(model, deps) {
  const entry = selectedEntry(model);
  if (!entry || model.manifestCache.has(entry.slug) || model.loadingSlug === entry.slug) {
    return null;
  }
  return loadManifestCmd(deps.cas, {
    slug: entry.slug,
    treeOid: entry.treeOid,
    source: model.source,
  });
}

function createShellState(columns, rows, source) {
  return {
    phase: 'title',
    titleTimeMs: 0,
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
    focusPane: 'ledger',
    chunkFocus: 0,
    promptEnter: false,
    gitBranch: null,
    vaultEncryptionKey: null,
  };
}

function createExplorerState(rows) {
  return {
    entries: [],
    filtered: [],
    filterText: '',
    metadata: null,
    manifestCache: new Map(),
    loadingSlug: null,
    error: null,
    table: createNavigableTableState({
      columns: FULL_COLUMNS,
      rows: [],
      height: tableHeight(rows),
    }),
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
    let metadata = null;
    try {
      metadata = await cas.getVaultMetadata();
    } catch {
      metadata = null;
    }
    if (metadata?.encryption) {
      return { type: 'vault-auth-check', encrypted: true, entryCount: 0, metadata };
    }
    try {
      const all = await cas.listVault();
      return {
        type: 'vault-auth-check',
        encrypted: Boolean(metadata?.encryption),
        entryCount: all.length,
        metadata,
      };
    } catch {
      return { type: 'vault-auth-check', encrypted: false, entryCount: 0, metadata: null };
    }
  };
}

async function deriveVaultKey(cas, metadata, passphrase) {
  const kdf = metadata?.encryption?.kdf;
  if (!kdf) {
    throw new Error('Missing vault encryption KDF metadata');
  }
  const { key } = await cas.deriveKey({
    passphrase,
    salt: Buffer.from(kdf.salt, 'base64'),
    algorithm: kdf.algorithm,
    iterations: kdf.iterations,
    cost: kdf.cost,
    blockSize: kdf.blockSize,
    parallelization: kdf.parallelization,
    keyLength: kdf.keyLength,
  });
  return key;
}

async function verifyVaultKeyAgainstEntries(cas, entries, encryptionKey) {
  for (const entry of entries) {
    const manifest = await cas.readManifest({ treeOid: entry.treeOid });
    const data = manifestData(manifest);
    if (data?.encryption?.encrypted || data?.encryption) {
      return await cas.verifyIntegrity(manifest, { encryptionKey });
    }
  }
  return true;
}

function verifyPassphraseCmd(cas, passphrase) {
  return async () => {
    try {
      const metadata = await cas.getVaultMetadata();
      const encryptionKey = await deriveVaultKey(cas, metadata, passphrase);
      const entries = await cas.listVault({ encryptionKey });
      const ok = await verifyVaultKeyAgainstEntries(cas, entries, encryptionKey);
      return ok
        ? { type: 'vault-auth-ok', encryptionKey }
        : { type: 'vault-auth-fail', error: 'Wrong passphrase' };
    } catch (err) {
      const authErrorCodes = [
        'INTEGRITY_ERROR',
        'DEK_UNWRAP_FAILED',
        'MISSING_KEY',
        'NO_MATCHING_RECIPIENT',
      ];
      const msg = authErrorCodes.includes(err.code)
        ? 'Wrong passphrase'
        : (err.message ?? String(err));
      return { type: 'vault-auth-fail', error: msg };
    }
  };
}

function casForModel(cas, model) {
  if (!model.vaultEncryptionKey) {
    return cas;
  }
  return new Proxy(cas, {
    get(target, prop, receiver) {
      if (prop === 'listVault') {
        return (options = {}) =>
          target.listVault({ ...options, encryptionKey: model.vaultEncryptionKey });
      }
      if (prop === 'addToVault') {
        return (options = {}) =>
          target.addToVault({ ...options, encryptionKey: model.vaultEncryptionKey });
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

const WIZARD_GZIP_COMPRESSION = Object.freeze({ algorithm: 'gzip' });
const WIZARD_CHUNKING_CONFIG = Object.freeze({
  fixed: Object.freeze({ strategy: 'fixed' }),
  cdc: Object.freeze({ strategy: 'cdc' }),
});
const WIZARD_MISSING_PASSPHRASE_MESSAGE = 'Encryption passphrase is required';

function validateStoreWizardPlan(wizard) {
  if (!wizard.passphrase) {
    return wizard.encryption === 'none' ? null : WIZARD_MISSING_PASSPHRASE_MESSAGE;
  }
  return null;
}

function storeWizardEncryptionOptions(wizard) {
  if (wizard.encryption === 'none') {
    return {};
  }
  if (wizard.encryption === 'convergent') {
    return { passphrase: wizard.passphrase, encryption: { scheme: 'convergent' } };
  }
  return { passphrase: wizard.passphrase };
}

function buildStoreWizardOptions(wizard) {
  return {
    filePath: wizard.filePath,
    slug: wizard.slug,
    ...storeWizardEncryptionOptions(wizard),
    ...(wizard.compression ? { compression: WIZARD_GZIP_COMPRESSION } : {}),
    chunking: WIZARD_CHUNKING_CONFIG[wizard.chunking],
  };
}

function runStoreWizardCmd(cas, wizard) {
  return async () => {
    try {
      const validationError = validateStoreWizardPlan(wizard);
      if (validationError) {
        return { type: 'store-error', error: validationError };
      }
      const manifest = await cas.storeFile(buildStoreWizardOptions(wizard));
      const treeOid = await cas.createTree({ manifest });
      await cas.addToVault({ slug: wizard.slug, treeOid, force: true });
      return { type: 'store-complete', slug: wizard.slug, treeOid, manifest };
    } catch (err) {
      return { type: 'store-error', error: err.message ?? String(err) };
    }
  };
}

function enterDashboard(model, deps) {
  const cas = casForModel(deps.cas, model);
  return [
    {
      ...model,
      phase: 'dashboard',
      promptEnter: false,
      authError: null,
      status: 'loading entries',
    },
    [loadEntriesCmd(cas, model.source), loadBranchCmd(cas), loadRefsCmd(cas)],
  ];
}

function toastCommand(spec) {
  return notify({
    ...spec,
    durationMs: 4_000,
  });
}

function handleTickMsg(msg, model, deps) {
  if (msg.type !== 'title-tick' || (model.phase !== 'title' && model.phase !== 'password')) {
    return [model, []];
  }
  return [
    {
      ...model,
      titleTimeMs: (model.titleTimeMs || 0) + TITLE_TICK_MS,
    },
    [deps.tick(TITLE_TICK_MS, { type: 'title-tick' })],
  ];
}

function handleVaultAuthCheck(msg, model) {
  if (msg.encrypted) {
    return [
      {
        ...model,
        phase: 'password',
        metadata: msg.metadata,
        vaultEntryCount: msg.entryCount,
        status: 'vault locked',
      },
      [],
    ];
  }
  return [
    {
      ...model,
      metadata: msg.metadata,
      promptEnter: true,
      vaultEntryCount: msg.entryCount,
      status: 'vault ready',
    },
    [],
  ];
}

function handleLoadedEntries(msg, model, deps) {
  if (!sourceEquals(msg.source, model.source)) {
    return [model, []];
  }
  const next = syncExplorer(model, {
    entries: msg.entries,
    metadata: msg.metadata,
    status: `${msg.entries.length} entries`,
    error: null,
  });
  const manifestCmd = maybeLoadSelectedManifest(next, deps);
  return [
    next,
    [loadStatsCmd(deps.cas, msg.entries, model.source), ...(manifestCmd ? [manifestCmd] : [])],
  ];
}

function handleLoadedManifest(msg, model) {
  if (!sourceEquals(msg.source, model.source)) {
    return [model, []];
  }
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
  return [next, [toastCommand({ title: 'Dashboard load failed', message: error, tone: 'ERROR' })]];
}

function handleAuthOkMsg(_msg, model, deps) {
  return enterDashboard({ ...model, vaultEncryptionKey: _msg.encryptionKey ?? null }, deps);
}

function handleAuthFailMsg(msg, model) {
  return [{ ...model, authError: msg.error, passphrase: '' }, []];
}

function handleLoadedRefsMsg(msg, model) {
  return [{ ...model, refsStatus: 'ready', refsInventory: msg.refs, refsError: null }, []];
}

function handleLoadedStatsMsg(msg, model) {
  if (!sourceEquals(msg.source, model.source)) {
    return [model, []];
  }
  return [{ ...model, statsStatus: 'ready', statsReport: msg.stats, statsError: null }, []];
}

function handleLoadedDoctorMsg(msg, model) {
  if (!sourceEquals(msg.source, model.source)) {
    return [model, []];
  }
  return [{ ...model, doctorStatus: 'ready', doctorReport: msg.report, doctorError: null }, []];
}

function handleLoadedTreemapMsg(msg, model) {
  return [
    {
      ...model,
      treemapStatus: 'ready',
      treemapReport: msg.report,
      treemapFocus: 0,
      treemapError: null,
    },
    [],
  ];
}

function handleLoadedBranchMsg(msg, model) {
  return [{ ...model, gitBranch: msg.branch }, []];
}

function handleStoreCompleteMsg(msg, model, deps) {
  const manifestCache = new Map(model.manifestCache);
  manifestCache.set(msg.slug, msg.manifest);
  const next = {
    ...syncExplorer(model, { manifestCache, storeWizard: null }),
    operationFeed: completeLatestOperation(model.operationFeed, msg.slug, null),
  };
  return [
    next,
    [
      loadEntriesCmd(casForModel(deps.cas, model), model.source),
      toastCommand({
        title: 'Stored asset',
        message: `${msg.slug} -> ${shortenSha(msg.treeOid)}`,
        tone: 'SUCCESS',
      }),
    ],
  ];
}

function handleStoreErrorMsg(msg, model) {
  const next = {
    ...model,
    storeWizard: model.storeWizard
      ? { ...model.storeWizard, step: 'error', error: msg.error }
      : null,
    operationFeed: completeLatestOperation(
      model.operationFeed,
      model.storeWizard?.slug ?? 'store',
      msg.error
    ),
  };
  return [next, [toastCommand({ title: 'Store failed', message: msg.error, tone: 'ERROR' })]];
}

function handleSelectAssetMsg(msg, model, deps) {
  const selected = model.entries.find((entry) => entry.slug === msg.slug);
  const next = syncExplorer(model, {
    workspace: 'explorer',
    explorerMode: 'manifest',
    filterText: selected ? selected.slug : model.filterText,
  });
  const manifestCmd = maybeLoadSelectedManifest(next, deps);
  return [next, manifestCmd ? [manifestCmd] : []];
}

function handleOpenStoreWizardMsg(_msg, model) {
  return [
    {
      ...model,
      workspace: 'operations',
      storeWizard: createWizardState(),
    },
    [],
  ];
}

function handleRefreshStatisticsMsg(_msg, model, deps) {
  return [
    {
      ...model,
      workspace: 'operations',
      statsStatus: 'loading',
      statsError: null,
    },
    [loadStatsCmd(deps.cas, model.entries, model.source)],
  ];
}

function handleRunDoctorMsg(_msg, model, deps) {
  return [
    {
      ...model,
      workspace: 'operations',
      doctorStatus: 'loading',
      doctorError: null,
    },
    [
      loadDoctorCmd(deps.cas, {
        source: model.source,
        entries: model.entries,
        encryptionKey: model.vaultEncryptionKey,
      }),
    ],
  ];
}

function handleClearAssetSearchMsg(_msg, model) {
  return [
    syncExplorer(model, {
      workspace: 'explorer',
      filterText: '',
    }),
    [],
  ];
}

const APP_MSG_HANDLERS = {
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
  'select-asset': handleSelectAssetMsg,
  'open-store-wizard': handleOpenStoreWizardMsg,
  'refresh-statistics': handleRefreshStatisticsMsg,
  'run-doctor': handleRunDoctorMsg,
  'clear-asset-search': handleClearAssetSearchMsg,
};

function handleAppMsg(msg, model, deps) {
  const handler = APP_MSG_HANDLERS[msg.type];
  return handler ? handler(msg, model, deps) : [model, []];
}

function handleTitleKey(msg, model, deps) {
  if (msg.key === 'enter' && model.promptEnter) {
    return enterDashboard(model, deps);
  }
  return [model, []];
}

function handlePasswordKey(msg, model, deps) {
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

const LEDGER_NAVIGATORS = {
  j: navTableFocusNext,
  down: navTableFocusNext,
  k: navTableFocusPrev,
  up: navTableFocusPrev,
  d: navTablePageDown,
  pagedown: navTablePageDown,
  u: navTablePageUp,
  pageup: navTablePageUp,
};

function handleExplorerNavigation(msg, model, deps) {
  if (model.focusPane !== 'ledger') {
    return null;
  }
  const navigate = LEDGER_NAVIGATORS[msg.key];
  if (!navigate) {
    return null;
  }
  const next = { ...model, table: navigate(model.table), chunkFocus: 0 };
  const manifestCmd = maybeLoadSelectedManifest(next, deps);
  return [next, manifestCmd ? [manifestCmd] : []];
}

function selectedChunks(model) {
  return selectedManifest(model)?.chunks ?? [];
}

function clampChunkFocus(model, nextFocus) {
  const chunks = selectedChunks(model);
  return Math.max(0, Math.min(nextFocus, Math.max(0, chunks.length - 1)));
}

function chunkPageStep(model) {
  return Math.max(1, Math.min(24, model.rows - 14));
}

function moveChunkFocus(model, delta) {
  return [{ ...model, chunkFocus: clampChunkFocus(model, model.chunkFocus + delta) }, []];
}

function detailDeltaForKey(key, model) {
  if (key === 'j' || key === 'down') {
    return 1;
  }
  if (key === 'k' || key === 'up') {
    return -1;
  }
  if (key === 'd' || key === 'pagedown') {
    return chunkPageStep(model);
  }
  if (key === 'u' || key === 'pageup') {
    return -chunkPageStep(model);
  }
  return null;
}

function handleDetailNavigation(msg, model) {
  if (model.focusPane !== 'detail' || model.explorerMode === 'ledger') {
    return null;
  }
  if (selectedChunks(model).length === 0) {
    return null;
  }
  const delta = detailDeltaForKey(msg.key, model);
  if (delta !== null) {
    return moveChunkFocus(model, delta);
  }
  if (msg.key === 'g') {
    return [{ ...model, chunkFocus: 0 }, []];
  }
  return null;
}

function switchWorkspace(model, workspace, deps) {
  const next = { ...model, workspace };
  if (workspace === 'atlas' && next.treemapStatus === 'idle') {
    const cas = casForModel(deps.cas, next);
    return [
      { ...next, treemapStatus: 'loading' },
      [
        loadTreemapCmd(cas, {
          source: next.source,
          scope: next.treemapScope,
          worktreeMode: next.treemapWorktreeMode,
          drillPath: next.treemapPath,
        }),
      ],
    ];
  }
  if (workspace === 'operations' && next.statsStatus === 'idle') {
    return [
      { ...next, statsStatus: 'loading' },
      [loadStatsCmd(deps.cas, next.entries, next.source)],
    ];
  }
  return [next, []];
}

function handleWorkspaceKey(msg, model, deps) {
  if (msg.key === '1' || msg.key === 'e') {
    return switchWorkspace(model, 'explorer', deps);
  }
  if (msg.key === '2' || msg.key === 'a') {
    return switchWorkspace(model, 'atlas', deps);
  }
  if (msg.key === '3' || msg.key === 'o') {
    return switchWorkspace(model, 'operations', deps);
  }
  return null;
}

function toggleExplorerDetail(model, deps) {
  const enteringDetail = model.explorerMode === 'ledger';
  const next = {
    ...model,
    explorerMode: enteringDetail ? 'manifest' : 'ledger',
    focusPane: enteringDetail ? 'detail' : 'ledger',
  };
  const manifestCmd = maybeLoadSelectedManifest(next, deps);
  return [next, manifestCmd ? [manifestCmd] : []];
}

function cycleMerkleMode(model) {
  const modes = /** @type {MerkleMode[]} */ (['table', 'tree', 'dag']);
  const nextMode = modes[(modes.indexOf(model.merkleMode) + 1) % modes.length];
  return [{ ...model, explorerMode: 'merkle', merkleMode: nextMode, focusPane: 'detail' }, []];
}

function toggleInspectorMode(model, deps) {
  const next = {
    ...model,
    explorerMode: model.explorerMode === 'manifest' ? 'merkle' : 'manifest',
    focusPane: 'detail',
  };
  const manifestCmd = maybeLoadSelectedManifest(next, deps);
  return [next, manifestCmd ? [manifestCmd] : []];
}

function handleExplorerModeKey(msg, model, deps) {
  if (msg.key === 'enter') {
    return toggleExplorerDetail(model, deps);
  }
  if (msg.key === 'm') {
    return cycleMerkleMode(model);
  }
  if (msg.key === 'i') {
    return toggleInspectorMode(model, deps);
  }
  return null;
}

function handleExplorerKey(msg, model, deps) {
  if (msg.key === 'tab') {
    return [{ ...model, focusPane: model.focusPane === 'ledger' ? 'detail' : 'ledger' }, []];
  }
  const detailNav = handleDetailNavigation(msg, model);
  if (detailNav) {
    return detailNav;
  }
  const nav = handleExplorerNavigation(msg, model, deps);
  if (nav) {
    return nav;
  }
  return handleExplorerModeKey(msg, model, deps);
}

function reloadTreemap(model, deps, patch = {}) {
  const next = { ...model, ...patch, treemapStatus: 'loading', treemapError: null };
  return [
    next,
    [
      loadTreemapCmd(casForModel(deps.cas, next), {
        source: next.source,
        scope: next.treemapScope,
        worktreeMode: next.treemapWorktreeMode,
        drillPath: next.treemapPath,
      }),
    ],
  ];
}

function focusAtlasTile(model, delta) {
  const tiles = model.treemapReport?.tiles ?? [];
  const maxFocus = Math.max(0, tiles.length - 1);
  return [
    { ...model, treemapFocus: Math.max(0, Math.min(model.treemapFocus + delta, maxFocus)) },
    [],
  ];
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
  scope: (_msg, model, deps) =>
    reloadTreemap(model, deps, {
      treemapScope: model.treemapScope === 'repository' ? 'source' : 'repository',
      treemapPath: [],
    }),
  worktreeMode: (_msg, model, deps) =>
    reloadTreemap(model, deps, {
      treemapWorktreeMode: model.treemapWorktreeMode === 'tracked' ? 'ignored' : 'tracked',
      treemapPath: [],
    }),
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
    entries: [
      {
        id: `store-${slug}-${Date.now()}`,
        type: 'store',
        slug,
        status: 'running',
        startTime: Date.now(),
        endTime: null,
        chunksTotal: 0,
        chunksProcessed: 0,
        error: null,
      },
      ...operationFeed.entries,
    ].slice(0, operationFeed.maxEntries),
  };
}

function completeLatestOperation(operationFeed, slug, error) {
  return {
    ...operationFeed,
    entries: operationFeed.entries.map((entry, index) => {
      if (index !== 0 || entry.slug !== slug) {
        return entry;
      }
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
  if (!model.storeWizard) {
    return null;
  }
  if (msg.key === 'escape') {
    return [{ ...model, storeWizard: null }, []];
  }
  const nextWizard = wizardHandleKey(model.storeWizard, msg.key);
  if (nextWizard.step === 'storing') {
    return [
      {
        ...model,
        storeWizard: nextWizard,
        operationFeed: startOperation(model.operationFeed, nextWizard.slug),
      },
      [runStoreWizardCmd(casForModel(deps.cas, model), nextWizard)],
    ];
  }
  return [{ ...model, storeWizard: nextWizard }, []];
}

function handleOperationsKey(msg, model, deps) {
  if (msg.key === 'n') {
    return [{ ...model, storeWizard: createWizardState() }, []];
  }
  if (msg.key === 's') {
    return [
      { ...model, statsStatus: 'loading', statsError: null },
      [loadStatsCmd(deps.cas, model.entries, model.source)],
    ];
  }
  if (msg.key === 'x') {
    return [
      {
        ...model,
        doctorStatus: 'loading',
        doctorError: null,
      },
      [
        loadDoctorCmd(deps.cas, {
          source: model.source,
          entries: model.entries,
          encryptionKey: model.vaultEncryptionKey,
        }),
      ],
    ];
  }
  return null;
}

function handleGlobalDashboardKey(msg, model, deps) {
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
  const wizard = handleWizardKey(msg, model, deps);
  if (wizard) {
    return wizard;
  }
  const global = handleGlobalDashboardKey(msg, model, deps);
  return global ?? handleWorkspaceSpecificKey(msg, model, deps) ?? [model, []];
}

function handleUpdate(msg, model, deps) {
  if (msg.type === 'key') {
    if (model.phase === 'title') {
      return handleTitleKey(msg, model, deps);
    }
    if (model.phase === 'password') {
      return handlePasswordKey(msg, model, deps);
    }
    return handleDashboardKey(msg, model, deps);
  }
  if (msg.type === 'resize') {
    return [syncExplorer(model, { columns: msg.columns, rows: msg.rows }), []];
  }
  return handleAppMsg(msg, model, deps);
}

function keyMessage(key, options = {}) {
  return {
    type: 'key',
    key,
    ctrl: options.ctrl ?? false,
    alt: options.alt ?? false,
    shift: options.shift ?? false,
  };
}

function createDashboardKeyMap() {
  return createKeyMap()
    .group('Workspaces', (group) =>
      group
        .bind('1', 'Open Explorer workspace', keyMessage('1'))
        .bind('2', 'Open Atlas workspace', keyMessage('2'))
        .bind('3', 'Open Operations workspace', keyMessage('3'))
        .bind('e', 'Open Explorer workspace', keyMessage('e'))
        .bind('a', 'Open Atlas workspace', keyMessage('a'))
        .bind('o', 'Open Operations workspace', keyMessage('o'))
    )
    .group('Navigate cockpit', (group) =>
      group
        .bind('tab', 'Change cockpit focus', keyMessage('tab'))
        .bind('j', 'Move down', keyMessage('j'))
        .bind('k', 'Move up', keyMessage('k'))
        .bind('down', 'Move down', keyMessage('down'))
        .bind('up', 'Move up', keyMessage('up'))
        .bind('d', 'Page down', keyMessage('d'))
        .bind('u', 'Page up', keyMessage('u'))
        .bind('pagedown', 'Page down', keyMessage('pagedown'))
        .bind('pageup', 'Page up', keyMessage('pageup'))
        .bind('g', 'Move to first item', keyMessage('g'))
        .bind('enter', 'Open or activate selection', keyMessage('enter'))
        .bind('escape', 'Close application overlay', keyMessage('escape'))
        .bind('backspace', 'Go back', keyMessage('backspace'))
    )
    .group('Explorer', (group) =>
      group
        .bind('m', 'Cycle Merkle view', keyMessage('m'))
        .bind('i', 'Toggle inspector view', keyMessage('i'))
    )
    .group('Atlas', (group) =>
      group
        .bind('t', 'Toggle atlas scope', keyMessage('t'))
        .bind('r', 'Reload atlas', keyMessage('r'))
        .bind('+', 'Drill into atlas tile', keyMessage('+'))
        .bind('-', 'Drill out of atlas tile', keyMessage('-'))
    )
    .group('Operations', (group) =>
      group
        .bind('n', 'Open store wizard', keyMessage('n'))
        .bind('s', 'Refresh vault statistics', keyMessage('s'))
        .bind('x', 'Run repository doctor', keyMessage('x'))
    );
}

function createDashboardModalKeyMap(model) {
  if (model.phase !== 'password' && !model.storeWizard) {
    return undefined;
  }
  // Bijou modal key maps intentionally swallow unmatched keys. Keep a compact
  // help surface, but make input handling total so text and shell-reserved
  // characters still reach the active password or wizard reducer.
  const helpMap = createKeyMap().group('Active input', (group) =>
    group
      .bind('enter', 'Confirm active input', keyMessage('enter'))
      .bind('backspace', 'Delete previous character', keyMessage('backspace'))
      .bind('escape', 'Cancel active input', keyMessage('escape'))
  );
  return {
    ...helpMap,
    handle(msg) {
      return msg;
    },
  };
}

function cockpitWorkspaceCommands() {
  return [
    {
      id: 'workspace-explorer',
      label: 'Open Explorer',
      category: 'workspace',
      shortcut: '1',
      action: keyMessage('1'),
    },
    {
      id: 'workspace-atlas',
      label: 'Open Repository Atlas',
      category: 'workspace',
      shortcut: '2',
      action: keyMessage('2'),
    },
    {
      id: 'workspace-operations',
      label: 'Open Operations',
      category: 'workspace',
      shortcut: '3',
      action: keyMessage('3'),
    },
  ];
}

function cockpitOperationCommands() {
  return [
    {
      id: 'store-asset',
      label: 'Store a new asset',
      category: 'operation',
      shortcut: 'n',
      action: { type: 'open-store-wizard' },
    },
    {
      id: 'refresh-statistics',
      label: 'Refresh vault statistics',
      category: 'operation',
      shortcut: 's',
      action: { type: 'refresh-statistics' },
    },
    {
      id: 'run-doctor',
      label: 'Run repository doctor',
      category: 'operation',
      shortcut: 'x',
      action: { type: 'run-doctor' },
    },
  ];
}

function buildCockpitCommands(model) {
  return [
    ...cockpitWorkspaceCommands(),
    ...cockpitOperationCommands(),
    ...(model.filterText
      ? [
          {
            id: 'clear-asset-search',
            label: 'Show all assets',
            category: 'search',
            action: { type: 'clear-asset-search' },
          },
        ]
      : []),
    ...(model.workspace === 'atlas'
      ? [
          {
            id: 'reload-atlas',
            label: 'Reload Repository Atlas',
            category: 'atlas',
            shortcut: 'r',
            action: keyMessage('r'),
          },
        ]
      : []),
  ];
}

function buildCockpitSearchItems(model) {
  return buildPaletteItems(model).map((item) => ({
    ...item,
    action: { type: 'select-asset', slug: item.id },
  }));
}

function cockpitVaultStatus(model) {
  if (model.metadata?.encryption && model.vaultEncryptionKey) {
    return 'encrypted / unlocked';
  }
  if (model.metadata?.encryption) {
    return 'encrypted / locked';
  }
  return 'plaintext vault';
}

function cockpitSourceLabel(source) {
  if (source.type === 'vault') {
    return 'vault';
  }
  if (source.type === 'ref') {
    return `ref ${source.ref}`;
  }
  return `oid ${source.treeOid}`;
}

function buildCockpitSettings(model, ctx) {
  return {
    title: 'Cockpit Settings',
    borderToken: ctx.theme.theme.border.primary,
    bgToken: ctx.theme.theme.surface.overlay,
    sections: [
      {
        id: 'session',
        title: 'Session',
        rows: [
          { id: 'workspace', label: 'Workspace', valueLabel: model.workspace, kind: 'info' },
          { id: 'focus', label: 'Focus', valueLabel: model.focusPane ?? '-', kind: 'info' },
          {
            id: 'source',
            label: 'Source',
            valueLabel: cockpitSourceLabel(model.source),
            kind: 'info',
          },
          { id: 'vault', label: 'Vault', valueLabel: cockpitVaultStatus(model), kind: 'info' },
        ],
      },
      {
        id: 'display',
        title: 'Display',
        rows: [
          {
            id: 'short-sha',
            label: 'Selected digest',
            description: 'The selected chunk expands in the cockpit detail status.',
            kind: 'info',
          },
        ],
      },
    ],
  };
}

export function createDashboardApp(deps) {
  return createFramedApp({
    title: 'git-cas',
    pages: [createDashboardPage(deps)],
    defaultPageId: 'cockpit',
    initialColumns: deps.ctx.runtime.columns ?? 80,
    initialRows: deps.ctx.runtime.rows ?? 24,
    enableCommandPalette: true,
    keyPriority: 'page-first',
    ctx: deps.ctx,
    observeKey(msg, route) {
      return route === 'unhandled' ? msg : undefined;
    },
    settings: ({ pageModel }) => buildCockpitSettings(pageModel, deps.ctx),
    runtimeNotifications: true,
  });
}

export function createDashboardPage(deps) {
  return {
    id: 'cockpit',
    title: 'Cockpit',
    init: () => [
      createInitModel(deps.ctx, deps.source),
      [checkVaultAuthCmd(deps.cas), deps.tick(TITLE_TICK_MS, { type: 'title-tick' })],
    ],
    update: (msg, model) => handleUpdate(msg, model, deps),
    keyMap: createDashboardKeyMap(),
    modalKeyMap: (model) => createDashboardModalKeyMap(model),
    commandItems: (model) => buildCockpitCommands(model),
    searchItems: (model) => buildCockpitSearchItems(model),
    searchTitle: 'Search assets',
    layout: (model) => ({
      kind: 'pane',
      paneId: 'cockpit',
      render: (width, height) => renderDashboard(model, deps, { width, height }),
    }),
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
  const app = createDashboardApp(deps);
  return options.runApp ? options.runApp(app, { ctx }) : app.run({ ctx });
}

export { buildTableRows, selectedEntry, selectedManifest, tableSchema };
export default launchDashboard;
