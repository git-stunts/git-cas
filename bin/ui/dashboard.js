/**
 * TEA app shell for the vault dashboard.
 */

import { startApp, tick } from '@flyingrobots/bijou';
import { createNavigableTableState, createNotificationState, tickNotifications } from '@flyingrobots/bijou-tui';
import { renderDashboard, tableSchema } from './dashboard-view.js';
import { createCliTuiContext } from './context.js';
import { formatTabSeparated } from './vault-list.js';

/**
 * @typedef {import('../index.js').default} ContentAddressableStore
 * @typedef {import('../src/domain/value-objects/Manifest.js').default} Manifest
 * @typedef {import('../src/domain/services/VaultService.js').VaultEntry} VaultEntry
 * @typedef {import('@flyingrobots/bijou').BijouContext} BijouContext
 * @typedef {import('@flyingrobots/bijou-tui').NavigableTableState} NavigableTableState
 * @typedef {import('@flyingrobots/bijou-tui').NotificationState} NotificationState
 */

/**
 * @typedef {'title' | 'password' | 'dashboard'} AppPhase
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
 * @property {VaultEntry[]} entries
 * @property {VaultEntry[]} filtered
 * @property {string} filterText
 * @property {boolean} filtering
 * @property {any} metadata
 * @property {Map<string, Manifest>} manifestCache
 * @property {string | null} loadingSlug
 * @property {any | null} detailPager
 * @property {any | null} detailAccordion
 * @property {any | null} dagPane
 * @property {boolean} quitConfirm
 * @property {any | null} storeWizard
 * @property {any | null} viewTransition
 * @property {string | null} error
 * @property {NavigableTableState} table
 * @property {NavigableTableState} refsTable
 * @property {any[]} refsItems
 * @property {'list' | 'detail'} viewMode
 * @property {any | null} palette
 * @property {boolean} showHelp
 * @property {boolean} promptEnter
 * @property {'stats' | 'doctor' | 'treemap' | 'refs' | null} activeDrawer
 * @property {any} refsStatus
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

function formatSize(bytes) {
  if (bytes < 1024) { return `${bytes}B`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)}K`; }
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

function buildTableRows(entries, manifestCache) {
  return entries.map((entry) => {
    const manifest = manifestCache.get(entry.slug);
    if (!manifest) {
      return [entry.slug, entry.treeOid, '...', '...', '...', '...', 'loading'];
    }
    const m = manifest.toJSON ? manifest.toJSON() : manifest;
    const crypto = m.encryption ? 'enc' : 'plain';
    const format = m.compression ? m.compression.algorithm : 'raw';
    const profile = m.subManifests?.length ? 'merkle' : 'single';
    return [
      entry.slug,
      entry.treeOid,
      formatSize(m.size ?? 0),
      String(m.chunks?.length ?? 0),
      crypto,
      format,
      profile,
    ];
  });
}

function tableHeight(rows) {
  return Math.max(1, rows - 8);
}

function createInitTable(rows, columns) {
  const schema = tableSchema(columns);
  return createNavigableTableState({
    columns: schema.columns,
    rows: [],
    height: tableHeight(rows),
  });
}

function createInitRefsTable(rows) {
  return createNavigableTableState({
    columns: [
      { header: 'Ref', width: 32 },
    ],
    rows: [],
    height: tableHeight(rows),
  });
}

function createInitModel(ctx, source) {
  const rows = ctx.runtime.rows ?? 24;
  const columns = ctx.runtime.columns ?? 80;
  return {
    phase: 'title',
    titleTimeMs: 0, lastTickTime: 0, fps: 0, showPerfHud: false,
    vaultEntryCount: 0,
    passphrase: '', authError: null,
    status: 'loading',
    columns, rows,
    source,
    entries: [], filtered: [],
    filterText: '', filtering: false,
    metadata: null,
    manifestCache: new Map(),
    loadingSlug: null, detailPager: null, detailAccordion: null,
    dagPane: null, quitConfirm: false, storeWizard: null,
    viewTransition: null, error: null,
    table: createInitTable(rows, columns),
    refsTable: createInitRefsTable(rows),
    refsItems: [],
    viewMode: 'list',
    palette: null, showHelp: false, activeDrawer: null,
    refsStatus: 'idle', refsError: null,
    statsStatus: 'idle', statsReport: null, statsError: null,
    doctorStatus: 'idle', doctorReport: null, doctorError: null,
    treemapScope: 'repository', treemapWorktreeMode: 'tracked', treemapPath: [],
    treemapFocus: 0, treemapStatus: 'idle', treemapReport: null, treemapError: null,
    notifications: createNotificationState(),
    gitBranch: null, promptEnter: false,
  };
}

function handleTickMsg(msg, model, deps) {
  if (msg.type === 'notification-tick') {
    const notifications = tickNotifications(model.notifications, Date.now());
    return [{ ...model, notifications }, []];
  }
  if (model.phase !== 'title' && model.phase !== 'password') { return [model, []]; }
  const now = Date.now();
  const elapsed = now - (model.lastTickTime || now);
  const fps = elapsed > 0 ? Math.round(1000 / elapsed) : 0;
  return [{ 
    ...model, 
    titleTimeMs: (model.titleTimeMs || 0) + 33,
    lastTickTime: now,
    fps: model.lastTickTime ? fps : 0 
  }, [deps.tick(33, { type: 'title-tick' })]];
}

function handleVaultAuthCheck(msg, model) {
  if (msg.encrypted) {
    return [{ ...model, phase: 'password', vaultEntryCount: msg.entryCount }, []];
  }
  return [{ ...model, promptEnter: true, vaultEntryCount: msg.entryCount }, []];
}

function handleVaultAuthOk(model, deps) {
  return [{ ...model, phase: 'dashboard', promptEnter: false, authError: null }, [
    loadEntriesCmd(deps.cas, deps.source),
  ]];
}

function loadEntriesCmd(cas, source) {
  return async (dispatch) => {
    try {
      const all = await cas.listVault();
      dispatch({ type: 'loaded-entries', entries: all, metadata: {}, source });
    } catch (err) {
      dispatch({ type: 'load-error', source: 'vault', error: err.message });
    }
  };
}

function checkVaultAuthCmd(cas, source) {
  return async (dispatch) => {
    try {
      const metadata = await cas.getVaultMetadata();
      const all = await cas.listVault();
      dispatch({ type: 'vault-auth-check', encrypted: Boolean(metadata?.encryption), entryCount: all.length, source });
    } catch {
      dispatch({ type: 'vault-auth-check', encrypted: false, entryCount: 0, source });
    }
  };
}

function verifyPassphraseCmd(cas, passphrase) {
  return async (dispatch) => {
    try {
      const entries = await cas.listVault();
      if (entries.length === 0) {
        dispatch({ type: 'vault-auth-ok' });
        return;
      }
      const manifest = await cas.readManifest({ treeOid: entries[0].treeOid });
      const ok = await cas.verifyIntegrity(manifest, { passphrase });
      if (ok) {
        dispatch({ type: 'vault-auth-ok' });
      } else {
        dispatch({ type: 'vault-auth-fail', error: 'Wrong passphrase' });
      }
    } catch (err) {
      const authErrorCodes = ['INTEGRITY_ERROR', 'DEK_UNWRAP_FAILED', 'MISSING_KEY', 'NO_MATCHING_RECIPIENT'];
      const msg = authErrorCodes.includes(err.code) ? 'Wrong passphrase' : (err.message ?? String(err));
      dispatch({ type: 'vault-auth-fail', error: msg });
    }
  };
}

function handleAppMsg(msg, model, deps) {
  if (msg.type === 'loaded-entries') {
    const table = { ...model.table, rows: buildTableRows(msg.entries, model.manifestCache) };
    return [{ ...model, entries: msg.entries, filtered: msg.entries, table }, []];
  }
  if (msg.type === 'notification-tick' || msg.type === 'title-tick') {
    return handleTickMsg(msg, model, deps);
  }
  if (msg.type === 'vault-auth-check') { return handleVaultAuthCheck(msg, model); }
  if (msg.type === 'vault-auth-ok') { return handleVaultAuthOk(model, deps); }
  if (msg.type === 'vault-auth-fail') { return [{ ...model, authError: msg.error, passphrase: '' }, []]; }
  if (msg.type === 'load-error') { return [{ ...model, error: msg.error }, []]; }
  return [model, []];
}

function handleTitleKey(msg, model) {
  if (msg.key === 'q') { return [model, [() => process.exit(0)]]; }
  if (msg.key === 'enter' && model.promptEnter) { return [{ ...model, promptEnter: false }, []]; }
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

function handleUpdate(msg, model, deps) {
  if (msg.type === 'key') {
    if (msg.key === '`') { return [{ ...model, showPerfHud: !model.showPerfHud }, []]; }
    if (model.phase === 'title') { return handleTitleKey(msg, model); }
    if (model.phase === 'password') { return handlePasswordKey(msg, model, deps); }
    if (msg.key === 'q') { return [model, [() => process.exit(0)]]; }
  }
  if (msg.type === 'resize') {
    return [{ ...model, columns: msg.columns, rows: msg.rows }, []];
  }
  return handleAppMsg(msg, model, deps);
}

export function createDashboardApp(deps) {
  return {
    init: () => [createInitModel(deps.ctx, deps.source), [checkVaultAuthCmd(deps.cas, deps.source), deps.tick(33, { type: 'title-tick' })]],
    update: (msg, model) => handleUpdate(msg, model, deps),
    view: (model) => renderDashboard(model, deps),
  };
}

async function printStaticList(cas, source, output) {
  if (source.type === 'vault') {
    const all = await cas.listVault();
    output.write(formatTabSeparated(all));
  } else if (source.type === 'oid') {
    output.write(`oid:${source.treeOid.slice(0, 12)}\t${source.treeOid}\n`);
  } else if (source.type === 'ref') {
    output.write(`${source.ref}\t${source.ref}\n`);
  }
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
  const dashTick = options.tick || tick;
  const deps = { cas, ctx, cwdLabel: options.cwd, source, tick: dashTick };
  const runApp = options.runApp || startApp;
  return runApp(createDashboardApp(deps), { ctx });
}

export default launchDashboard;
