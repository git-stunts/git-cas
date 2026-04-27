/**
 * TEA app shell for the vault dashboard.
 */

import { startApp } from '@flyingrobots/bijou-node';
import {
  quit, tick, createKeyMap,
  createNavigableTableState, navTableFocusNext, navTableFocusPrev, navTablePageDown, navTablePageUp,
  createCommandPaletteState, cpFilter, cpFocusNext, cpFocusPrev, cpPageDown, cpPageUp, cpSelectedItem, commandPaletteKeyMap,
  createNotificationState, pushNotification, dismissNotification, tickNotifications, notificationsNeedTick, hasNotifications,
  createPagerState, pagerScrollBy, pagerPageDown, pagerPageUp,
  createAccordionState, focusNext as accordionFocusNext, focusPrev as accordionFocusPrev, toggleFocused as accordionToggleFocused,
  createDagPaneState, dagPaneSelectChild, dagPaneSelectParent, dagPaneSelectLeft, dagPaneSelectRight,
  dagPaneScrollBy, dagPanePageDown, dagPanePageUp, dagPaneScrollByX,
} from '@flyingrobots/bijou-tui';
import { loadEntriesCmd, loadManifestCmd, loadRefsCmd, loadStatsCmd, loadDoctorCmd, loadTreemapCmd, loadBranchCmd, readSourceEntries } from './dashboard-cmds.js';
import { createCliTuiContext, detectCliTuiMode } from './context.js';
import { renderDashboard } from './dashboard-view.js';
import { renderManifestView, buildManifestSections } from './manifest-view.js';
import { buildDagSource } from './merkle-dag.js';
import { createWizardState, wizardHandleKey } from './store-wizard.js';

/**
 * @typedef {import('@flyingrobots/bijou').BijouContext} BijouContext
 * @typedef {import('@flyingrobots/bijou-tui').KeyMsg} KeyMsg
 * @typedef {import('@flyingrobots/bijou-tui').ResizeMsg} ResizeMsg
 * @typedef {import('@flyingrobots/bijou-tui').Cmd<DashMsg>} DashCmd
 * @typedef {import('@flyingrobots/bijou-tui').KeyMap<DashAction>} DashKeyMap
 * @typedef {import('@flyingrobots/bijou-tui').NavigableTableState} NavigableTableState
 * @typedef {import('@flyingrobots/bijou-tui').CommandPaletteState} CommandPaletteState
 * @typedef {import('@flyingrobots/bijou-tui').PagerState} PagerState
 * @typedef {import('@flyingrobots/bijou-tui').AccordionState} AccordionState
 * @typedef {import('@flyingrobots/bijou-tui').DagPaneState} DagPaneState
 * @typedef {import('./store-wizard.js').StoreWizardState} StoreWizardState
 * @typedef {import('../../index.js').default} ContentAddressableStore
 * @typedef {import('../../src/domain/value-objects/Manifest.js').default} Manifest
 * @typedef {import('./dashboard-cmds.js').TreemapScope} TreemapScope
 * @typedef {import('./dashboard-cmds.js').TreemapWorktreeMode} TreemapWorktreeMode
 * @typedef {import('./dashboard-cmds.js').TreemapPathNode} TreemapPathNode
 * @typedef {import('./dashboard-cmds.js').RepoTreemapTile} RepoTreemapTile
 * @typedef {import('./dashboard-cmds.js').RefInventory} RefInventory
 * @typedef {import('./dashboard-cmds.js').RefInventoryItem} RefInventoryItem
 * @typedef {{ slug: string, treeOid: string }} VaultEntry
 * @typedef {{ type: 'vault' } | { type: 'ref', ref: string } | { type: 'oid', treeOid: string }} DashSource
 * @typedef {'idle' | 'loading' | 'ready' | 'error'} LoadState
 */

/**
 * @typedef {{ type: 'quit' }
 *   | { type: 'move', delta: number }
 *   | { type: 'page', delta: number }
 *   | { type: 'select' }
 *   | { type: 'filter-start' }
 *   | { type: 'scroll-detail', delta: number }
 *   | { type: 'page-detail', delta: number }
 *   | { type: 'open-palette' }
 *   | { type: 'open-stats' }
 *   | { type: 'open-doctor' }
 *   | { type: 'open-treemap' }
 *   | { type: 'open-refs' }
 *   | { type: 'toggle-treemap-scope' }
 *   | { type: 'toggle-treemap-worktree' }
 *   | { type: 'treemap-drill-in' }
 *   | { type: 'treemap-drill-out' }
 *   | { type: 'toggle-help' }
 *   | { type: 'accordion-toggle' }
 *   | { type: 'open-merkle-dag' }
 *   | { type: 'open-store-wizard' }
 *   | { type: 'dag-select-parent' }
 *   | { type: 'dag-select-child' }
 *   | { type: 'dag-select-left' }
 *   | { type: 'dag-select-right' }
 *   | { type: 'dag-scroll', delta: number }
 *   | { type: 'dag-scroll-x', delta: number }
 *   | { type: 'dag-page', delta: number }
 *   | { type: 'overlay-close' }
 * } DashAction
 */

/**
 * @typedef {{ type: 'focus-next' }
 *   | { type: 'focus-prev' }
 *   | { type: 'page-down' }
 *   | { type: 'page-up' }
 *   | { type: 'select' }
 *   | { type: 'close' }
 * } PaletteAction
 */

/**
 * @typedef {{ type: 'loaded-entries', entries: VaultEntry[], metadata: any, source: DashSource }
 *   | { type: 'loaded-manifest', slug: string, manifest: Manifest, source: DashSource }
 *   | { type: 'loaded-refs', refs: RefInventory }
 *   | { type: 'loaded-stats', stats: any, source: DashSource }
 *   | { type: 'loaded-doctor', report: any, source: DashSource }
 *   | { type: 'loaded-treemap', report: any }
 *   | { type: 'loaded-branch', branch: string | null }
 *   | { type: 'notification-tick' }
 *   | { type: 'title-tick' }
 *   | { type: 'load-error', source: string, slug?: string, forSource?: DashSource, scopeId?: TreemapScope, worktreeMode?: TreemapWorktreeMode, drillPath?: TreemapPathNode[], error: string }
 * } DashMsg
 */

/**
 * @typedef {'title' | 'password' | 'dashboard'} AppPhase
 */

/**
 * @typedef {Object} DashModel
 * @property {AppPhase} phase
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
 * @property {PagerState | null} detailPager
 * @property {string | null} error
 * @property {NavigableTableState} table
 * @property {NavigableTableState} refsTable
 * @property {RefInventoryItem[]} refsItems
 * @property {'list' | 'detail'} viewMode
 * @property {CommandPaletteState | null} palette
 * @property {boolean} showHelp
 * @property {'stats' | 'doctor' | 'treemap' | 'refs' | null} activeDrawer
 * @property {LoadState} refsStatus
 * @property {string | null} refsError
 * @property {LoadState} statsStatus
 * @property {any | null} statsReport
 * @property {string | null} statsError
 * @property {LoadState} doctorStatus
 * @property {any | null} doctorReport
 * @property {string | null} doctorError
 * @property {TreemapScope} treemapScope
 * @property {TreemapWorktreeMode} treemapWorktreeMode
 * @property {TreemapPathNode[]} treemapPath
 * @property {number} treemapFocus
 * @property {LoadState} treemapStatus
 * @property {any | null} treemapReport
 * @property {string | null} treemapError
 * @property {import('@flyingrobots/bijou-tui').NotificationState<DashMsg>} notifications
 * @property {string | null} gitBranch
 * @property {AccordionState | null} detailAccordion
 * @property {DagPaneState | null} dagPane
 * @property {boolean} quitConfirm
 * @property {StoreWizardState | null} storeWizard
 * @property {{ startTime: number, duration: number, shader: string } | null} viewTransition
 */

/**
 * @typedef {Object} DashDeps
 * @property {DashKeyMap} keyMap
 * @property {ContentAddressableStore} cas
 * @property {BijouContext} ctx
 * @property {string | undefined} [cwdLabel]
 * @property {DashSource} source
 */

/**
 * Create keyboard bindings for normal mode.
 *
 * @returns {DashKeyMap}
 */
export function createKeyBindings() {
  return createKeyMap()
    .bind('q', 'Quit', { type: 'quit' })
    .bind('?', 'Help', { type: 'toggle-help' })
    .group('Navigation', (g) => g
      .bind('j', 'Down', { type: 'move', delta: 1 })
      .bind('down', 'Down', { type: 'move', delta: 1 })
      .bind('k', 'Up', { type: 'move', delta: -1 })
      .bind('up', 'Up', { type: 'move', delta: -1 })
      .bind('d', 'Page down', { type: 'page', delta: 1 })
      .bind('pagedown', 'Page down', { type: 'page', delta: 1 })
      .bind('u', 'Page up', { type: 'page', delta: -1 })
      .bind('pageup', 'Page up', { type: 'page', delta: -1 })
      .bind('enter', 'Load', { type: 'select' })
      .bind('l', 'Load', { type: 'select' })
      .bind('h', 'Back', { type: 'overlay-close' })
      .bind('/', 'Filter', { type: 'filter-start' }))
    .group('Layout', (g) => g
      .bind('ctrl+p', 'Palette', { type: 'open-palette' })
      .bind(':', 'Palette', { type: 'open-palette' })
      .bind('escape', 'Close overlay', { type: 'overlay-close' }))
    .group('Views', (g) => g
      .bind('s', 'Stats', { type: 'open-stats' })
      .bind('g', 'Doctor', { type: 'open-doctor' })
      .bind('t', 'Treemap', { type: 'open-treemap' })
      .bind('r', 'Refs', { type: 'open-refs' }))
    .group('Treemap', (g) => g
      .bind('shift+t', 'Treemap scope', { type: 'toggle-treemap-scope' })
      .bind('i', 'Treemap files', { type: 'toggle-treemap-worktree' })
      .bind('shift+=', 'Treemap descend', { type: 'treemap-drill-in' })
      .bind('-', 'Treemap ascend', { type: 'treemap-drill-out' }))
    .group('Detail', (g) => g
      .bind('shift+j', 'Scroll down', { type: 'scroll-detail', delta: 3 })
      .bind('shift+k', 'Scroll up', { type: 'scroll-detail', delta: -3 })
      .bind('space', 'Toggle section', { type: 'accordion-toggle' })
      .bind('m', 'Merkle DAG', { type: 'open-merkle-dag' })
      .bind('n', 'Store', { type: 'open-store-wizard' }));
}

const TABLE_COLUMNS = [
  { header: 'Slug', width: 20 },
  { header: 'Size', width: 8, align: 'right' },
  { header: 'Chunks', width: 6, align: 'right' },
  { header: 'Crypto', width: 7 },
  { header: 'Format', width: 10 },
  { header: 'Profile', width: 12 },
];

const DASH_HEADER_ROWS = 4;
const DASH_FOOTER_ROWS = 3;
const PANE_BORDER_ROWS = 2;
const LIST_META_ROWS = 2;
const NOTIFICATION_TICK_MS = 50;
const TRANSITION_DURATION_MS = 150;
const REDUCE_MOTION = process.env.REDUCE_MOTION === '1';
const DETAIL_BODY_TOP = 3;

/**
 * Inject a view transition into a [model, cmds] result.
 *
 * @param {[DashModel, DashCmd[]]} result
 * @param {string} shader
 * @returns {[DashModel, DashCmd[]]}
 */
function withTransition(result, shader) {
  const vt = startTransition(shader);
  return [{ ...result[0], viewTransition: vt }, result[1]];
}

/**
 * Command to check vault metadata and determine if auth is needed.
 *
 * @param {ContentAddressableStore} cas
 * @param {DashSource} source
 * @returns {DashCmd}
 */
function checkVaultAuthCmd(cas, source) {
  return async (/** @type {(msg: DashMsg) => void} */ dispatch) => {
    try {
      const metadata = await cas.getVaultMetadata();
      dispatch({ type: 'vault-auth-check', encrypted: Boolean(metadata?.encryption), source });
    } catch {
      dispatch({ type: 'vault-auth-check', encrypted: false, source });
    }
  };
}

/**
 * Handle the vault auth check result.
 *
 * @param {{ type: 'vault-auth-check', encrypted: boolean, source: DashSource }} msg
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function handleVaultAuthCheck(msg, model, deps) {
  if (msg.encrypted) {
    return [{ ...model, phase: 'password' }, []];
  }
  return handleVaultAuthOk(model, deps);
}

/**
 * Transition from title/password to the main dashboard.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function handleVaultAuthOk(model, deps) {
  return [{
    ...model,
    phase: 'dashboard',
    authError: null,
  }, [
    /** @type {DashCmd} */ (loadEntriesCmd(deps.cas, deps.source)),
    /** @type {DashCmd} */ (loadBranchCmd(deps.cas)),
  ]];
}

/**
 * Command to verify a passphrase against the vault.
 *
 * @param {ContentAddressableStore} cas
 * @param {string} passphrase
 * @returns {DashCmd}
 */
function verifyPassphraseCmd(cas, passphrase) {
  return async (/** @type {(msg: DashMsg) => void} */ dispatch) => {
    try {
      const entries = await cas.listVault();
      if (entries.length === 0) {
        dispatch({ type: 'vault-auth-ok' });
        return;
      }
      const first = entries[0];
      const manifest = await cas.readManifest({ treeOid: first.treeOid });
      const ok = await cas.verifyIntegrity(manifest, { passphrase });
      if (ok) {
        dispatch({ type: 'vault-auth-ok' });
      } else {
        dispatch({ type: 'vault-auth-fail', error: 'Wrong passphrase' });
      }
    } catch (/** @type {any} */ err) {
      const authErrorCodes = ['INTEGRITY_ERROR', 'DEK_UNWRAP_FAILED', 'MISSING_KEY', 'NO_MATCHING_RECIPIENT'];
      const msg = authErrorCodes.includes(err.code) ? 'Wrong passphrase' : (err.message ?? String(err));
      dispatch({ type: 'vault-auth-fail', error: msg });
    }
  };
}

/**
 * Handle key events during the title screen.
 *
 * @param {KeyMsg} msg
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function handleTitleKey(msg, model, deps) {
  if (msg.key === 'q') {
    return [model, [quit()]];
  }
  if (msg.key === 'enter' && model.promptEnter) {
    return handleVaultAuthOk(model, deps);
  }
  return [model, []];
}

/**
 * Handle key events during the password entry phase.
 *
 * @param {KeyMsg} msg
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function handlePasswordKey(msg, model, deps) {
  if (msg.key === 'q' && msg.ctrl) {
    return [model, [quit()]];
  }
  if (msg.key === 'escape') {
    return [model, [quit()]];
  }
  if (msg.key === 'enter') {
    return [{ ...model, authError: null }, [verifyPassphraseCmd(deps.cas, model.passphrase)]];
  }
  if (msg.key === 'backspace') {
    return [{ ...model, passphrase: model.passphrase.slice(0, -1), authError: null }, []];
  }
  if (msg.key.length === 1 && !msg.ctrl && !msg.alt) {
    return [{ ...model, passphrase: model.passphrase + msg.key, authError: null }, []];
  }
  return [model, []];
}

/**
 * Start a view transition if motion is enabled.
 * Uses a timestamp so progress is computed at render time without extra commands.
 *
 * @param {string} [shader='fade']
 * @returns {{ startTime: number, duration: number, shader: string } | null}
 */
function startTransition(shader = 'fade') {
  if (REDUCE_MOTION) { return null; }
  return { startTime: Date.now(), duration: TRANSITION_DURATION_MS, shader };
}

/**
 * Estimate the pager viewport height for the detail pane.
 *
 * @param {number} termRows
 * @returns {number}
 */
function detailPagerHeight(termRows) {
  const bodyHeight = Math.max(1, termRows - DASH_HEADER_ROWS - DASH_FOOTER_ROWS);
  const innerHeight = Math.max(1, bodyHeight - PANE_BORDER_ROWS);
  return Math.max(1, innerHeight - DETAIL_BODY_TOP);
}

/**
 * Build a detail pager from manifest content.
 *
 * @param {import('../../src/domain/value-objects/Manifest.js').default} manifest
 * @param {BijouContext} ctx
 * @param {number} termRows
 * @returns {PagerState}
 */
function buildDetailPager(manifest, ctx, termRows) {
  const data = manifest.toJSON ? manifest.toJSON() : manifest;
  const content = renderManifestView({ manifest: data, ctx });
  return createPagerState({ content, width: 1, height: detailPagerHeight(termRows) });
}

/**
 * Build a detail accordion from manifest sections.
 *
 * @param {import('../../src/domain/value-objects/Manifest.js').default} manifest
 * @param {BijouContext} ctx
 * @returns {import('@flyingrobots/bijou-tui').AccordionState}
 */
function buildDetailAccordion(manifest, ctx) {
  const data = manifest.toJSON ? manifest.toJSON() : manifest;
  const sections = buildManifestSections({ manifest: data, ctx });
  return createAccordionState(sections);
}

const PALETTE_ITEMS = [
  {
    id: 'refs',
    label: 'Browse Refs',
    description: 'List refs by namespace and switch the dashboard source to a CAS-backed ref',
    category: 'View',
    shortcut: 'r',
  },
  {
    id: 'treemap',
    label: 'Open Repo Treemap',
    description: 'Full-screen semantic atlas of the repo, refs, vault, and active source',
    category: 'View',
    shortcut: 't',
  },
  {
    id: 'treemap-scope',
    label: 'Toggle Treemap Scope',
    description: 'Switch the treemap between repository and source views',
    category: 'View',
    shortcut: 'T',
  },
  {
    id: 'treemap-worktree',
    label: 'Toggle Repo Files',
    description: 'Switch repository treemap files between git ls-files and ignored paths',
    category: 'View',
    shortcut: 'i',
  },
  {
    id: 'treemap-drill-in',
    label: 'Treemap Descend',
    description: 'Drill into the focused treemap region',
    category: 'View',
    shortcut: '+',
  },
  {
    id: 'treemap-drill-out',
    label: 'Treemap Ascend',
    description: 'Return to the parent treemap level',
    category: 'View',
    shortcut: '-',
  },
  {
    id: 'stats',
    label: 'Open Source Stats',
    description: 'Logical size, dedup ratio, and format coverage',
    category: 'View',
    shortcut: 's',
  },
  {
    id: 'doctor',
    label: 'Open Doctor Report',
    description: 'Health summary and vault issues',
    category: 'View',
    shortcut: 'g',
  },
  {
    id: 'close-drawer',
    label: 'Close Active View',
    description: 'Leave treemap view or dismiss the stats or doctor overlay',
    category: 'View',
    shortcut: 'esc',
  },
];

const paletteKeyMap = commandPaletteKeyMap({
  focusNext: { type: 'focus-next' },
  focusPrev: { type: 'focus-prev' },
  pageDown: { type: 'page-down' },
  pageUp: { type: 'page-up' },
  select: { type: 'select' },
  close: { type: 'close' },
});

/**
 * Format manifest bytes as a compact human-readable string for the explorer table.
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  if (bytes < 1024) { return `${bytes}B`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)}K`; }
  if (bytes < 1024 * 1024 * 1024) { return `${(bytes / (1024 * 1024)).toFixed(1)}M`; }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

/**
 * Table viewport height based on the full dashboard frame.
 *
 * @param {number} rows
 * @returns {number}
 */
function tableHeight(rows) {
  return Math.max(1, rows - DASH_HEADER_ROWS - DASH_FOOTER_ROWS - PANE_BORDER_ROWS - LIST_META_ROWS);
}

/**
 * Clamp table scroll so the focused row remains visible.
 *
 * @param {{ focusRow: number, scrollY: number, height: number, totalRows: number }} options
 * @returns {number}
 */
function adjustTableScroll(options) {
  let nextScroll = options.scrollY;
  if (options.focusRow < nextScroll) {
    nextScroll = options.focusRow;
  } else if (options.focusRow >= nextScroll + options.height) {
    nextScroll = options.focusRow - options.height + 1;
  }
  return Math.min(nextScroll, Math.max(0, options.totalRows - options.height));
}

/**
 * Build explorer table rows from the filtered vault entries.
 *
 * @param {VaultEntry[]} entries
 * @param {Map<string, Manifest>} manifestCache
 * @returns {string[][]}
 */
function buildTableRows(entries, manifestCache) {
  return entries.map((entry) => {
    const manifest = manifestCache.get(entry.slug);
    if (!manifest) {
      return [entry.slug, '...', '...', '...', '...', 'loading'];
    }
    const m = manifest.toJSON ? manifest.toJSON() : manifest;
    const crypto = m.encryption ? 'enc' : 'plain';
    const format = m.compression ? m.compression.algorithm : 'raw';
    const profile = m.subManifests?.length ? `${format} merkle` : `${format} single`;
    return [
      entry.slug,
      formatSize(m.size ?? 0),
      String(m.chunks?.length ?? 0),
      crypto,
      format,
      profile,
    ];
  });
}

/**
 * Synchronize derived table rows and viewport metrics after a model change.
 *
 * @param {NavigableTableState} table
 * @param {{
 *   entries?: VaultEntry[],
 *   manifestCache?: Map<string, Manifest>,
 *   rows?: number,
 *   focusRow?: number,
 *   scrollY?: number,
 * }} updates
 * @returns {NavigableTableState}
 */
function syncTable(table, updates = {}) {
  const rows = buildTableRows(updates.entries ?? [], updates.manifestCache ?? new Map());
  const height = tableHeight(updates.rows ?? 24);
  const focusRow = Math.max(0, Math.min(updates.focusRow ?? table.focusRow, rows.length - 1));
  const scrollY = adjustTableScroll({
    focusRow,
    scrollY: updates.scrollY ?? table.scrollY,
    height,
    totalRows: rows.length,
  });
  return {
    ...table,
    rows,
    height,
    focusRow,
    scrollY,
  };
}

/**
 * Return true when two dashboard sources describe the same target.
 *
 * @param {DashSource} left
 * @param {DashSource} right
 * @returns {boolean}
 */
function sourceEquals(left, right) {
  if (left.type !== right.type) {
    return false;
  }
  if (left.type === 'vault') {
    return true;
  }
  if (left.type === 'ref' && right.type === 'ref') {
    return left.ref === right.ref;
  }
  return left.type === 'oid' && right.type === 'oid' && left.treeOid === right.treeOid;
}

/**
 * Return true when two treemap drill paths describe the same level.
 *
 * @param {TreemapPathNode[]} left
 * @param {TreemapPathNode[]} right
 * @returns {boolean}
 */
function treemapPathEquals(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((node, index) =>
    node.kind === right[index]?.kind
    && node.label === right[index]?.label
    && node.segments.length === right[index]?.segments.length
    && node.segments.every((segment, segmentIndex) => segment === right[index]?.segments[segmentIndex]));
}

/**
 * Clamp treemap focus to the current tile list.
 *
 * @param {number} focus
 * @param {RepoTreemapTile[]} tiles
 * @returns {number}
 */
function clampTreemapFocus(focus, tiles) {
  return Math.max(0, Math.min(focus, tiles.length - 1));
}

/**
 * Return the selected treemap tile from the current report.
 *
 * @param {DashModel} model
 * @returns {RepoTreemapTile | null}
 */
function selectedTreemapTile(model) {
  return model.treemapReport?.tiles[clampTreemapFocus(model.treemapFocus, model.treemapReport?.tiles ?? [])] ?? null;
}

/**
 * Build rows for the refs browser table.
 *
 * @param {RefInventoryItem[]} refs
 * @returns {string[][]}
 */
function buildRefRows(refs) {
  return refs.map((ref) => [
    ref.namespace,
    ref.ref,
    ref.browsable ? ref.resolution : 'opaque',
    String(ref.entryCount),
    ref.oid.slice(0, 12),
  ]);
}

/**
 * Synchronize refs-browser rows and viewport metrics after a model change.
 *
 * @param {NavigableTableState} table
 * @param {{
 *   refs?: RefInventoryItem[],
 *   rows?: number,
 *   focusRow?: number,
 *   scrollY?: number,
 * }} updates
 * @returns {NavigableTableState}
 */
function syncRefsTable(table, updates = {}) {
  const rows = buildRefRows(updates.refs ?? []);
  const height = tableHeight(updates.rows ?? 24);
  const focusRow = Math.max(0, Math.min(updates.focusRow ?? table.focusRow, rows.length - 1));
  const scrollY = adjustTableScroll({
    focusRow,
    scrollY: updates.scrollY ?? table.scrollY,
    height,
    totalRows: rows.length,
  });
  return {
    ...table,
    rows,
    height,
    focusRow,
    scrollY,
  };
}

/**
 * Palette viewport height based on terminal rows.
 *
 * @param {number} rows
 * @returns {number}
 */
function paletteHeight(rows) {
  return Math.max(5, Math.min(10, rows - 10));
}

/**
 * Create a fresh command palette state for the dashboard.
 *
 * @param {number} rows
 * @returns {CommandPaletteState}
 */
function createPalette(rows) {
  return createCommandPaletteState(PALETTE_ITEMS, paletteHeight(rows));
}

/**
 * Replace the palette state on the model.
 *
 * @param {DashModel} model
 * @param {CommandPaletteState | null} palette
 * @returns {[DashModel, DashCmd[]]}
 */
function setPalette(model, palette) {
  return [{ ...model, palette }, []];
}

/** @type {Record<string, import('@flyingrobots/bijou-tui').NotificationTone>} */
const LEVEL_TO_TONE = {
  error: 'ERROR',
  warning: 'WARNING',
  info: 'INFO',
  success: 'SUCCESS',
};

/**
 * Schedule a notification tick command when animations are in progress.
 *
 * @param {import('@flyingrobots/bijou-tui').NotificationState<DashMsg>} notifications
 * @returns {DashCmd[]}
 */
function notificationTickCmds(notifications) {
  if (notificationsNeedTick(notifications)) {
    return [/** @type {DashCmd} */ (tick(NOTIFICATION_TICK_MS, { type: 'notification-tick' }))];
  }
  return [];
}

/**
 * Add a toast notification via Bijou's notification system.
 *
 * @param {DashModel} model
 * @param {{ level: string, title: string, message: string }} toastSpec
 * @returns {[DashModel, DashCmd[]]}
 */
function addToast(model, toastSpec) {
  const notifications = pushNotification(model.notifications, {
    title: toastSpec.title,
    message: toastSpec.message,
    tone: LEVEL_TO_TONE[toastSpec.level] ?? 'INFO',
    variant: 'TOAST',
    placement: 'LOWER_RIGHT',
    durationMs: 6000,
  }, Date.now());
  return [{ ...model, notifications }, notificationTickCmds(notifications)];
}

/**
 * Return true when a treemap load message is stale for the current model.
 *
 * @param {{ scopeId?: TreemapScope, worktreeMode?: TreemapWorktreeMode, drillPath?: TreemapPathNode[] }} msg
 * @param {DashModel} model
 * @returns {boolean}
 */
function isStaleTreemapLoad(msg, model) {
  if (msg.scopeId && msg.scopeId !== model.treemapScope) {
    return true;
  }
  if (msg.drillPath && !treemapPathEquals(msg.drillPath, model.treemapPath)) {
    return true;
  }
  return msg.scopeId === 'repository'
    && Boolean(msg.worktreeMode)
    && msg.worktreeMode !== model.treemapWorktreeMode;
}

/**
 * Return true when a load/error message was emitted for a source that is no
 * longer active on the dashboard.
 *
 * @param {{ forSource?: DashSource }} msg
 * @param {DashModel} model
 * @returns {boolean}
 */
function isStaleSourceLoad(msg, model) {
  return Boolean(msg.forSource) && !sourceEquals(msg.forSource, model.source);
}

/**
 * Apply load/error state for source-scoped async operations.
 *
 * @param {DashMsg & { type: 'load-error' }} msg
 * @param {DashModel} model
 * @returns {DashModel}
 */
function applySourceLoadErrorState(msg, model) {
  if (msg.source === 'entries') {
    return isStaleSourceLoad(msg, model) ? model : { ...model, status: 'error', error: msg.error };
  }
  if (msg.source === 'manifest') {
    return isStaleSourceLoad(msg, model)
      ? model
      : { ...model, loadingSlug: model.loadingSlug === msg.slug ? null : model.loadingSlug };
  }
  if (msg.source === 'stats') {
    return isStaleSourceLoad(msg, model) ? model : { ...model, statsStatus: 'error', statsError: msg.error };
  }
  if (msg.source === 'doctor') {
    return isStaleSourceLoad(msg, model) ? model : { ...model, doctorStatus: 'error', doctorError: msg.error };
  }
  return model;
}

/**
 * Apply state changes caused by an async load error.
 *
 * @param {DashMsg & { type: 'load-error' }} msg
 * @param {DashModel} model
 * @returns {DashModel}
 */
function applyLoadErrorState(msg, model) {
  if (msg.source === 'refs') {
    return { ...model, refsStatus: 'error', refsError: msg.error };
  }
  if (msg.source === 'treemap') {
    return isStaleTreemapLoad(msg, model) ? model : { ...model, treemapStatus: 'error', treemapError: msg.error };
  }
  if (['entries', 'manifest', 'stats', 'doctor'].includes(msg.source)) {
    return applySourceLoadErrorState(msg, model);
  }
  return { ...model, status: 'error', error: msg.error };
}

/**
 * Human-readable toast title for async load errors.
 *
 * @param {DashMsg & { type: 'load-error' }} msg
 * @returns {string}
 */
function loadErrorTitle(msg) {
  if (msg.source === 'manifest') {
    return msg.slug ? `Failed to load ${msg.slug}` : 'Failed to load manifest';
  }
  if (msg.source === 'stats') {
    return 'Failed to load source stats';
  }
  if (msg.source === 'doctor') {
    return 'Failed to load doctor report';
  }
  if (msg.source === 'refs') {
    return 'Failed to load refs';
  }
  if (msg.source === 'treemap') {
    return 'Failed to load repo treemap';
  }
  return 'Failed to load entries';
}

/**
 * Create the initial explorer table state.
 *
 * @param {number} rows
 * @returns {NavigableTableState}
 */
function createInitTable(rows) {
  return createNavigableTableState({
    columns: TABLE_COLUMNS,
    rows: [],
    height: tableHeight(rows),
  });
}

/**
 * Create the initial refs-browser table state.
 *
 * @param {number} rows
 * @returns {NavigableTableState}
 */
function createInitRefsTable(rows) {
  return createNavigableTableState({
    columns: [
      { header: 'Namespace', width: 14 },
      { header: 'Ref', width: 34 },
      { header: 'Kind', width: 10 },
      { header: 'Entries', width: 7, align: 'right' },
      { header: 'OID', width: 12 },
    ],
    rows: [],
    height: tableHeight(rows),
  });
}

/**
 * Create the initial model.
 *
 * @param {BijouContext} ctx
 * @param {DashSource} source
 * @returns {DashModel}
 */
function createInitModel(ctx, source) {
  const rows = ctx.runtime.rows ?? 24;
  return {
    phase: 'title',
    titleTimeMs: 0,
    passphrase: '',
    authError: null,
    status: 'loading',
    columns: ctx.runtime.columns ?? 80, rows,
    source,
    entries: [],
    filtered: [],
    filterText: '',
    filtering: false,
    metadata: null,
    manifestCache: new Map(),
    loadingSlug: null,
    detailPager: null,
    detailAccordion: null,
    dagPane: null,
    quitConfirm: false,
    storeWizard: null,
    viewTransition: null,
    error: null,
    table: createInitTable(rows),
    refsTable: createInitRefsTable(rows),
    refsItems: [],
    viewMode: 'list',
    palette: null,
    showHelp: false,
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
    notifications: createNotificationState(),
    gitBranch: null,
  };
}

/**
 * Handle actions that are specific to full-screen refs mode.
 *
 * @param {DashAction} action
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]] | null}
 */
function handleRefsViewAction(action, model, deps) {
  if (model.activeDrawer !== 'refs') {
    return null;
  }
  if (action.type === 'move') {
    return handleRefsMove(action, model);
  }
  if (action.type === 'page') {
    return handleRefsPage(action, model);
  }
  if (action.type === 'select') {
    return handleRefSelect(model, deps);
  }
  if (isBlockedByTreemapView(action)) {
    return [model, []];
  }
  return null;
}

/**
 * Handle cursor movement inside the treemap view.
 *
 * @param {{ type: 'move', delta: number }} action
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function handleTreemapMove(action, model) {
  const total = model.treemapReport?.tiles.length ?? 0;
  if (total === 0) {
    return [model, []];
  }
  const treemapFocus = (model.treemapFocus + action.delta + total) % total;
  return [{ ...model, treemapFocus }, []];
}

/**
 * Handle page-wise movement inside the treemap view.
 *
 * @param {{ type: 'page', delta: number }} action
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function handleTreemapPage(action, model) {
  const total = model.treemapReport?.tiles.length ?? 0;
  if (total === 0) {
    return [model, []];
  }
  const pageSize = Math.max(1, Math.min(8, model.rows - 16));
  const treemapFocus = clampTreemapFocus(model.treemapFocus + (action.delta * pageSize), model.treemapReport?.tiles ?? []);
  return [{ ...model, treemapFocus }, []];
}

/**
 * Descend into the focused treemap region when it has child nodes.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function handleTreemapDrillIn(model, deps) {
  const tile = selectedTreemapTile(model);
  if (!tile) {
    return [model, []];
  }
  if (!tile.drillable || !tile.path) {
    return addToast(model, {
      level: 'info',
      title: 'Leaf region',
      message: `${tile.label} does not have a deeper treemap level.`,
    });
  }

  const nextModel = {
    ...model,
    treemapPath: [...model.treemapPath, tile.path],
    treemapFocus: 0,
    activeDrawer: 'treemap',
    palette: null,
  };
  if (treemapReportMatches(nextModel, model.treemapReport)) {
    return [{
      ...nextModel,
      treemapStatus: 'ready',
      treemapError: null,
    }, []];
  }
  return [{
    ...nextModel,
    treemapStatus: 'loading',
    treemapError: null,
  }, [treemapLoad(nextModel, deps)]];
}

/**
 * Ascend to the parent treemap level.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function handleTreemapDrillOut(model, deps) {
  if (model.treemapPath.length === 0) {
    return [model, []];
  }
  const nextModel = {
    ...model,
    treemapPath: model.treemapPath.slice(0, -1),
    treemapFocus: 0,
    activeDrawer: 'treemap',
    palette: null,
  };
  if (treemapReportMatches(nextModel, model.treemapReport)) {
    return [{
      ...nextModel,
      treemapStatus: 'ready',
      treemapError: null,
    }, []];
  }
  return [{
    ...nextModel,
    treemapStatus: 'loading',
    treemapError: null,
  }, [treemapLoad(nextModel, deps)]];
}

/**
 * Handle actions that are specific to the full-screen treemap view.
 *
 * @param {DashAction} action
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]] | null}
 */
function handleTreemapViewAction(action, model, deps) {
  if (model.activeDrawer !== 'treemap') {
    return null;
  }
  if (action.type === 'move') {
    return handleTreemapMove(action, model);
  }
  if (action.type === 'page') {
    return handleTreemapPage(action, model);
  }
  if (action.type === 'select' || action.type === 'treemap-drill-in') {
    return handleTreemapDrillIn(model, deps);
  }
  if (action.type === 'treemap-drill-out') {
    return handleTreemapDrillOut(model, deps);
  }
  return null;
}

/**
 * Apply filter text to entries.
 *
 * @param {VaultEntry[]} entries
 * @param {string} text
 * @returns {VaultEntry[]}
 */
function applyFilter(entries, text) {
  if (!text) { return entries; }
  return entries.filter((/** @type {VaultEntry} */ e) => e.slug.includes(text));
}

/**
 * Sort entries by manifest size descending, biggest first.
 * Entries without a loaded manifest sort to the bottom by slug.
 *
 * @param {VaultEntry[]} entries
 * @param {Map<string, Manifest>} manifestCache
 * @returns {VaultEntry[]}
 */
function sortBySize(entries, manifestCache) {
  return [...entries].sort((a, b) => {
    const ma = manifestCache.get(a.slug);
    const mb = manifestCache.get(b.slug);
    const sa = ma ? (ma.toJSON ? ma.toJSON() : ma).size ?? 0 : -1;
    const sb = mb ? (mb.toJSON ? mb.toJSON() : mb).size ?? 0 : -1;
    if (sa === sb) { return a.slug.localeCompare(b.slug); }
    return sb - sa;
  });
}

/**
 * Handle the loaded-entries message.
 *
 * @param {DashMsg & { type: 'loaded-entries' }} msg
 * @param {DashModel} model
 * @param {ContentAddressableStore} cas
 * @returns {[DashModel, DashCmd[]]}
 */
function handleLoadedEntries(msg, model, cas) {
  if (!sourceEquals(msg.source, model.source)) {
    return [model, []];
  }
  const filtered = sortBySize(applyFilter(msg.entries, model.filterText), model.manifestCache);
  const table = syncTable(model.table, {
    entries: filtered,
    manifestCache: model.manifestCache,
    rows: model.rows,
  });
  const cmds = /** @type {DashCmd[]} */ (msg.entries.map((/** @type {VaultEntry} */ e) => loadManifestCmd(cas, {
    slug: e.slug,
    treeOid: e.treeOid,
    source: msg.source,
  })));
  return [{
    ...model,
    status: 'ready',
    entries: msg.entries,
    filtered,
    metadata: msg.metadata,
    loadingSlug: null,
    table,
  }, cmds];
}

/**
 * Handle a loaded-manifest message.
 *
 * @param {DashMsg & { type: 'loaded-manifest' }} msg
 * @param {DashModel} model
 * @param {BijouContext} ctx
 * @returns {[DashModel, DashCmd[]]}
 */
function handleLoadedManifest(msg, model, ctx) {
  if (!sourceEquals(msg.source, model.source)) {
    return [model, []];
  }
  const cache = new Map(model.manifestCache);
  cache.set(msg.slug, msg.manifest);
  const filtered = sortBySize(model.filtered, cache);
  const table = syncTable(model.table, {
    entries: filtered,
    manifestCache: cache,
    rows: model.rows,
  });
  const selectedSlug = filtered[model.table.focusRow]?.slug;
  const detailPager = selectedSlug === msg.slug
    ? buildDetailPager(msg.manifest, ctx, model.rows)
    : model.detailPager;
  const detailAccordion = selectedSlug === msg.slug
    ? buildDetailAccordion(msg.manifest, ctx)
    : model.detailAccordion;
  return [{
    ...model,
    manifestCache: cache,
    filtered,
    loadingSlug: model.loadingSlug === msg.slug ? null : model.loadingSlug,
    table,
    detailPager,
    detailAccordion,
  }, []];
}

/**
 * Handle cursor movement.
 *
 * @param {{ type: 'move', delta: number }} msg
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function handleMove(msg, model, ctx) {
  const table = msg.delta > 0 ? navTableFocusNext(model.table) : navTableFocusPrev(model.table);
  const selected = model.filtered[table.focusRow];
  const cached = selected ? model.manifestCache.get(selected.slug) : null;
  const detailPager = cached ? buildDetailPager(cached, ctx, model.rows) : null;
  const detailAccordion = cached ? buildDetailAccordion(cached, ctx) : null;
  return [{ ...model, table, detailPager, detailAccordion }, []];
}

/**
 * Handle page-wise table navigation.
 *
 * @param {{ type: 'page', delta: number }} msg
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function handlePage(msg, model, ctx) {
  const table = msg.delta > 0 ? navTablePageDown(model.table) : navTablePageUp(model.table);
  const selected = model.filtered[table.focusRow];
  const cached = selected ? model.manifestCache.get(selected.slug) : null;
  const detailPager = cached ? buildDetailPager(cached, ctx, model.rows) : null;
  const detailAccordion = cached ? buildDetailAccordion(cached, ctx) : null;
  return [{ ...model, table, detailPager, detailAccordion }, []];
}

/**
 * Handle filter key input in filter mode.
 *
 * @param {KeyMsg} msg
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function handleFilterKey(msg, model) {
  if (msg.key === 'escape' || msg.key === 'enter') {
    return [{ ...model, filtering: false }, []];
  }
  if (msg.key === 'backspace') {
    const text = model.filterText.slice(0, -1);
    const filtered = sortBySize(applyFilter(model.entries, text), model.manifestCache);
    const table = syncTable(model.table, {
      entries: filtered,
      manifestCache: model.manifestCache,
      rows: model.rows,
      focusRow: 0,
      scrollY: 0,
    });
    return [{ ...model, filterText: text, filtered, table }, []];
  }
  if (msg.key.length === 1) {
    const text = model.filterText + msg.key;
    const filtered = sortBySize(applyFilter(model.entries, text), model.manifestCache);
    const table = syncTable(model.table, {
      entries: filtered,
      manifestCache: model.manifestCache,
      rows: model.rows,
      focusRow: 0,
      scrollY: 0,
    });
    return [{ ...model, filterText: text, filtered, table }, []];
  }
  return [model, []];
}

/**
 * Handle select (enter key) to load manifest.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function handleSelect(model, deps) {
  if (model.viewMode === 'detail') {
    return handleDetailAccordionAction({ type: 'accordion-toggle' }, model) ?? [model, []];
  }
  const entry = model.filtered[model.table.focusRow];
  if (!entry) {
    return [model, []];
  }
  if (model.manifestCache.has(entry.slug)) {
    const manifest = model.manifestCache.get(entry.slug);
    const detailPager = buildDetailPager(manifest, deps.ctx, model.rows);
    const detailAccordion = buildDetailAccordion(manifest, deps.ctx);
    return withTransition([{ ...model, viewMode: 'detail', detailPager, detailAccordion }, []], 'fade');
  }
  const cmd = /** @type {DashCmd} */ (loadManifestCmd(deps.cas, {
    slug: entry.slug,
    treeOid: entry.treeOid,
    source: model.source,
  }));
  return withTransition([{
    ...model,
    viewMode: 'detail',
    loadingSlug: entry.slug,
    detailPager: null,
    detailAccordion: null,
  }, [cmd]], 'fade');
}

/**
 * Open the refs browser and trigger a load when needed.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function openRefsDrawer(model, deps) {
  if (model.refsStatus === 'ready' || model.refsStatus === 'loading') {
    return [{
      ...model,
      activeDrawer: 'refs',
      palette: null,
    }, []];
  }
  return [{
    ...model,
    activeDrawer: 'refs',
    palette: null,
    refsStatus: 'loading',
    refsError: null,
  }, [/** @type {DashCmd} */ (loadRefsCmd(deps.cas))]];
}

/**
 * Open the stats drawer and trigger a load when needed.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function openStatsDrawer(model, deps) {
  if (model.statsStatus === 'ready' || model.statsStatus === 'loading') {
    return [{
      ...model,
      activeDrawer: 'stats',
      palette: null,
    }, []];
  }
  return [{
    ...model,
    activeDrawer: 'stats',
    palette: null,
    statsStatus: 'loading',
    statsError: null,
  }, [/** @type {DashCmd} */ (loadStatsCmd(deps.cas, model.entries, model.source))]];
}

/**
 * Open the doctor drawer and trigger a load when needed.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function openDoctorDrawer(model, deps) {
  if (model.doctorStatus === 'ready' || model.doctorStatus === 'loading') {
    return [{
      ...model,
      activeDrawer: 'doctor',
      palette: null,
    }, []];
  }
  return [{
    ...model,
    activeDrawer: 'doctor',
    palette: null,
    doctorStatus: 'loading',
    doctorError: null,
  }, [/** @type {DashCmd} */ (loadDoctorCmd(deps.cas, model.source, model.entries))]];
}

/**
 * Build a treemap load command from the current dashboard state.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {{ scope?: TreemapScope, worktreeMode?: TreemapWorktreeMode, drillPath?: TreemapPathNode[] }} [overrides]
 * @returns {DashCmd}
 */
function treemapLoad(model, deps, overrides = {}) {
  return /** @type {DashCmd} */ (loadTreemapCmd(deps.cas, {
    source: model.source,
    scope: overrides.scope ?? model.treemapScope,
    worktreeMode: overrides.worktreeMode ?? model.treemapWorktreeMode,
    drillPath: overrides.drillPath ?? model.treemapPath,
  }));
}

/**
 * Open the repo treemap view and trigger a load when needed.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function openTreemapDrawer(model, deps) {
  if (treemapReportMatches(model, model.treemapReport)) {
    return [{
      ...model,
      activeDrawer: 'treemap',
      palette: null,
    }, []];
  }
  if (model.treemapStatus === 'loading') {
    return [{
      ...model,
      activeDrawer: 'treemap',
      palette: null,
    }, []];
  }
  return [{
    ...model,
    activeDrawer: 'treemap',
    palette: null,
    treemapStatus: 'loading',
    treemapError: null,
  }, [treemapLoad(model, deps)]];
}

/**
 * Keep the refs browser state stable while a source switch reloads entries.
 *
 * @param {DashModel} model
 * @returns {{ refsStatus: LoadState, refsItems: RefInventoryItem[], refsTable: NavigableTableState }}
 */
function preserveRefsState(model) {
  return {
    refsStatus: model.refsStatus,
    refsItems: model.refsItems,
    refsTable: syncRefsTable(model.refsTable, {
      refs: model.refsItems,
      rows: model.rows,
      focusRow: model.refsTable.focusRow,
      scrollY: model.refsTable.scrollY,
    }),
  };
}

/**
 * Reset source-scoped explorer state ahead of loading a different source.
 *
 * @param {DashModel} model
 * @param {DashSource} source
 * @returns {DashModel}
 */
function buildSourceSwitchModel(model, source) {
  const clearedTable = syncTable(model.table, {
    entries: [],
    manifestCache: new Map(),
    rows: model.rows,
    focusRow: 0,
    scrollY: 0,
  });

  return {
    ...model,
    ...preserveRefsState(model),
    palette: null,
    activeDrawer: null,
    source,
    status: 'loading',
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
    table: clearedTable,
    viewMode: 'list',
    statsStatus: 'idle',
    statsReport: null,
    statsError: null,
    doctorStatus: 'idle',
    doctorReport: null,
    doctorError: null,
    treemapStatus: 'idle',
    treemapReport: null,
    treemapError: null,
    treemapPath: [],
    treemapFocus: 0,
  };
}

/**
 * Toggle the treemap between repository and source scopes.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function toggleTreemapScope(model, deps) {
  const treemapScope = model.treemapScope === 'repository' ? 'source' : 'repository';
  const nextModel = {
    ...model,
    treemapScope,
    treemapPath: [],
    treemapFocus: 0,
  };
  if (treemapReportMatches(nextModel, model.treemapReport)) {
    return [{
      ...nextModel,
      activeDrawer: 'treemap',
      palette: null,
      treemapStatus: 'ready',
      treemapError: null,
    }, []];
  }
  return [{
    ...nextModel,
    activeDrawer: 'treemap',
    palette: null,
    treemapStatus: 'loading',
    treemapError: null,
  }, [treemapLoad(nextModel, deps)]];
}

/**
 * Toggle repository treemap file visibility between tracked and ignored paths.
 *
 * This control is repository-specific, so switching visibility also returns the
 * view to repository scope when needed.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function toggleTreemapWorktreeMode(model, deps) {
  const treemapWorktreeMode = model.treemapWorktreeMode === 'tracked' ? 'ignored' : 'tracked';
  const nextModel = {
    ...model,
    treemapScope: 'repository',
    treemapWorktreeMode,
    treemapPath: [],
    treemapFocus: 0,
    activeDrawer: 'treemap',
    palette: null,
  };
  if (treemapReportMatches(nextModel, model.treemapReport)) {
    return [{
      ...nextModel,
      treemapStatus: 'ready',
      treemapError: null,
    }, []];
  }
  return [{
    ...nextModel,
    treemapStatus: 'loading',
    treemapError: null,
  }, [treemapLoad(nextModel, deps)]];
}

/**
 * Open the Merkle DAG viewer for the currently selected manifest.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function openMerkleDag(model, deps) {
  const entry = model.filtered[model.table.focusRow];
  if (!entry) {
    return [model, []];
  }
  const manifest = model.manifestCache.get(entry.slug);
  if (!manifest) {
    return [model, []];
  }
  const m = manifest.toJSON ? manifest.toJSON() : manifest;
  const source = buildDagSource(m);
  const state = createDagPaneState({
    source,
    width: Math.max(1, model.columns - 2),
    height: Math.max(1, model.rows - 6),
    selectedId: 'root',
    ctx: deps.ctx,
  });
  return [{ ...model, dagPane: state, palette: null }, []];
}

/**
 * Handle DAG pane navigation actions.
 *
 * @param {DashAction} action
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]] | null}
 */
function handleDagAction(action, model, deps) {
  if (!model.dagPane) {
    return null;
  }
  const ctx = deps.ctx;
  const handlers = {
    'dag-select-parent': () => ({ ...model, dagPane: dagPaneSelectParent(model.dagPane, ctx) }),
    'dag-select-child': () => ({ ...model, dagPane: dagPaneSelectChild(model.dagPane, ctx) }),
    'dag-select-left': () => ({ ...model, dagPane: dagPaneSelectLeft(model.dagPane, ctx) }),
    'dag-select-right': () => ({ ...model, dagPane: dagPaneSelectRight(model.dagPane, ctx) }),
    'dag-scroll': () => ({ ...model, dagPane: dagPaneScrollBy(model.dagPane, action.delta) }),
    'dag-scroll-x': () => ({ ...model, dagPane: dagPaneScrollByX(model.dagPane, action.delta) }),
    'dag-page': () => {
      const pager = action.delta > 0 ? dagPanePageDown : dagPanePageUp;
      return { ...model, dagPane: pager(model.dagPane) };
    },
  };
  if (action.type in handlers) {
    return [handlers[action.type](), []];
  }
  return null;
}

/**
 * Handle raw key events when the store wizard is active.
 *
 * @param {KeyMsg} msg
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function handleWizardKey(msg, model, deps) {
  const next = wizardHandleKey(model.storeWizard, msg.key);
  if (next.step === 'error') {
    return [{ ...model, storeWizard: null }, []];
  }
  if (next.step === 'storing') {
    return [{ ...model, storeWizard: next }, [executeStoreCmd(next, deps)]];
  }
  if (next.step === 'done') {
    return [{ ...model, storeWizard: null }, [loadEntriesCmd(deps.cas, model.source)]];
  }
  return [{ ...model, storeWizard: next }, []];
}

/**
 * Create a command that executes the store operation.
 *
 * @param {StoreWizardState} wizard
 * @param {DashDeps} deps
 * @returns {DashCmd}
 */
function executeStoreCmd(wizard, deps) {
  return async (/** @type {(msg: DashMsg) => void} */ dispatch) => {
    try {
      const { createReadStream } = await import('node:fs');
      const stream = createReadStream(wizard.filePath);
      /** @type {Record<string, any>} */
      const opts = { slug: wizard.slug };
      if (wizard.compression) { opts.gzip = true; }
      if (wizard.chunking === 'cdc') { opts.strategy = 'cdc'; }
      if (wizard.chunking === 'fixed') { opts.strategy = 'fixed'; }
      if (wizard.encryption === 'convergent') { opts.convergent = true; }
      await deps.cas.store(stream, opts);
      dispatch({ type: 'wizard-store-done', slug: wizard.slug });
    } catch (/** @type {any} */ err) {
      dispatch({ type: 'wizard-store-error', error: err.message ?? String(err) });
    }
  };
}

/**
 * Handle raw key events when the DAG pane is active.
 *
 * @param {KeyMsg} msg
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function handleDagKey(msg, model, deps) {
  /** @type {Record<string, DashAction>} */
  const keyActions = {
    up: { type: 'dag-select-parent' },
    down: { type: 'dag-select-child' },
    left: { type: 'dag-select-left' },
    right: { type: 'dag-select-right' },
    j: { type: 'dag-scroll', delta: 3 },
    k: { type: 'dag-scroll', delta: -3 },
    h: { type: 'dag-scroll-x', delta: -5 },
    l: { type: 'dag-scroll-x', delta: 5 },
    d: { type: 'dag-page', delta: 1 },
    u: { type: 'dag-page', delta: -1 },
    escape: { type: 'overlay-close' },
    q: { type: 'overlay-close' },
  };
  const action = keyActions[msg.key];
  if (action) {
    return handleAction(action, model, deps);
  }
  return [model, []];
}

/**
 * Close the command palette or active view, whichever is visible.
 *
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function closeOverlay(model) {
  if (model.showHelp) {
    return [{ ...model, showHelp: false }, []];
  }
  if (model.palette) {
    return [{ ...model, palette: null }, []];
  }
  if (model.storeWizard) {
    return [{ ...model, storeWizard: null }, []];
  }
  if (model.dagPane) {
    return [{ ...model, dagPane: null }, []];
  }
  if (model.activeDrawer) {
    return withTransition([{ ...model, activeDrawer: null }, []], 'fade');
  }
  if (model.viewMode === 'detail') {
    return withTransition([{ ...model, viewMode: 'list' }, []], 'fade');
  }
  if (hasNotifications(model.notifications)) {
    const topItem = model.notifications.items[0];
    if (topItem) {
      const notifications = dismissNotification(model.notifications, topItem.id, Date.now());
      return [{ ...model, notifications }, notificationTickCmds(notifications)];
    }
  }
  return [model, []];
}

/**
 * Close the active view from the command palette.
 *
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function closeDrawerFromPalette(model) {
  return [{
    ...model,
    palette: null,
    activeDrawer: null,
  }, []];
}

/**
 * Switch the dashboard to a new source and reload explorer entries for it.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @param {DashSource} source
 * @returns {[DashModel, DashCmd[]]}
 */
function switchSource(model, deps, source) {
  if (sourceEquals(model.source, source)) {
    return [{
      ...model,
      palette: null,
      activeDrawer: null,
    }, []];
  }
  return [buildSourceSwitchModel(model, source), [/** @type {DashCmd} */ (loadEntriesCmd(deps.cas, source))]];
}

/**
 * Handle cursor movement inside the refs browser.
 *
 * @param {{ type: 'move', delta: number }} action
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function handleRefsMove(action, model) {
  const refsTable = action.delta > 0 ? navTableFocusNext(model.refsTable) : navTableFocusPrev(model.refsTable);
  return [{ ...model, refsTable }, []];
}

/**
 * Handle page-wise movement inside the refs browser.
 *
 * @param {{ type: 'page', delta: number }} action
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function handleRefsPage(action, model) {
  const refsTable = action.delta > 0 ? navTablePageDown(model.refsTable) : navTablePageUp(model.refsTable);
  return [{ ...model, refsTable }, []];
}

/**
 * Switch the dashboard source to the focused ref when it resolves to CAS data.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function handleRefSelect(model, deps) {
  const ref = model.refsItems[model.refsTable.focusRow];
  if (!ref) {
    return [model, []];
  }
  if (!ref.browsable || !ref.source) {
    return addToast(model, {
      level: 'warning',
      title: 'Ref is not browsable',
      message: `${ref.ref} does not currently resolve to CAS entries.`,
    });
  }
  return switchSource(model, deps, ref.source);
}

/**
 * Apply the focused command palette item.
 *
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function handlePaletteSelect(model, deps) {
  const item = model.palette ? cpSelectedItem(model.palette) : undefined;
  if (!item) {
    return [{ ...model, palette: null }, []];
  }
  const handlers = {
    refs: () => openRefsDrawer(model, deps),
    treemap: () => openTreemapDrawer(model, deps),
    'treemap-scope': () => toggleTreemapScope(model, deps),
    'treemap-worktree': () => toggleTreemapWorktreeMode(model, deps),
    'treemap-drill-in': () => handleTreemapDrillIn(model, deps),
    'treemap-drill-out': () => handleTreemapDrillOut(model, deps),
    stats: () => openStatsDrawer(model, deps),
    doctor: () => openDoctorDrawer(model, deps),
    'close-drawer': () => closeDrawerFromPalette(model),
  };
  if (item.id in handlers) {
    return handlers[item.id]();
  }
  return [{ ...model, palette: null }, []];
}

/**
 * Apply palette navigation actions emitted by the palette keymap.
 *
 * @param {PaletteAction} action
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function handlePaletteAction(action, model, deps) {
  if (!model.palette) {
    return [model, []];
  }
  switch (action.type) {
    case 'focus-next':
      return setPalette(model, cpFocusNext(model.palette));
    case 'focus-prev':
      return setPalette(model, cpFocusPrev(model.palette));
    case 'page-down':
      return setPalette(model, cpPageDown(model.palette));
    case 'page-up':
      return setPalette(model, cpPageUp(model.palette));
    case 'select':
      return handlePaletteSelect(model, deps);
    case 'close':
      return setPalette(model, null);
    default:
      return [model, []];
  }
}

/**
 * Update the palette query while keeping focus/scroll logic inside Bijou.
 *
 * @param {DashModel} model
 * @param {string} query
 * @returns {[DashModel, DashCmd[]]}
 */
function filterPalette(model, query) {
  if (!model.palette) {
    return [model, []];
  }
  return setPalette(model, cpFilter(model.palette, query));
}

/**
 * Return true when the key should append to the palette query.
 *
 * @param {KeyMsg} msg
 * @returns {boolean}
 */
function isPaletteQueryKey(msg) {
  return msg.key.length === 1 && !msg.ctrl && !msg.alt;
}

/**
 * Route key input while the command palette is open.
 *
 * @param {KeyMsg} msg
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function handlePaletteKey(msg, model, deps) {
  if (!model.palette) {
    return [model, []];
  }
  const action = /** @type {PaletteAction | undefined} */ (paletteKeyMap.handle(msg));
  if (action) {
    return handlePaletteAction(action, model, deps);
  }
  if (msg.key === 'backspace') {
    return filterPalette(model, model.palette.query.slice(0, -1));
  }
  if (isPaletteQueryKey(msg)) {
    return filterPalette(model, model.palette.query + msg.key);
  }
  return [model, []];
}

/**
 * Start filter mode with the full entry set visible.
 *
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function startFilter(model) {
  const filtered = model.entries;
  const table = syncTable(model.table, {
    entries: filtered,
    manifestCache: model.manifestCache,
    rows: model.rows,
    focusRow: 0,
    scrollY: 0,
  });
  return [{ ...model, filtering: true, filterText: '', filtered, table }, []];
}

/**
 * Handle overlay-related actions.
 *
 * @param {DashAction} action
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]] | null}
 */
function handleOverlayAction(action, model, deps) {
  const handlers = {
    'open-palette': () => setPalette(model, createPalette(model.rows)),
    'open-stats': () => model.activeDrawer === 'stats'
      ? withTransition([{ ...model, activeDrawer: null }, []], 'fade')
      : withTransition(openStatsDrawer(model, deps), 'fade'),
    'open-doctor': () => model.activeDrawer === 'doctor'
      ? withTransition([{ ...model, activeDrawer: null }, []], 'fade')
      : withTransition(openDoctorDrawer(model, deps), 'fade'),
    'open-refs': () => model.activeDrawer === 'refs'
      ? withTransition([{ ...model, activeDrawer: null }, []], 'fade')
      : withTransition(openRefsDrawer(model, deps), 'fade'),
    'open-treemap': () => model.activeDrawer === 'treemap'
      ? withTransition([{ ...model, activeDrawer: null }, []], 'wipe')
      : withTransition(openTreemapDrawer(model, deps), 'wipe'),
    'toggle-treemap-scope': () => toggleTreemapScope(model, deps),
    'toggle-treemap-worktree': () => toggleTreemapWorktreeMode(model, deps),
    'treemap-drill-in': () => handleTreemapDrillIn(model, deps),
    'treemap-drill-out': () => handleTreemapDrillOut(model, deps),
    'toggle-help': () => [{ ...model, showHelp: !model.showHelp }, []],
    'open-merkle-dag': () => model.dagPane
      ? [{ ...model, dagPane: null }, []]
      : openMerkleDag(model, deps),
    'open-store-wizard': () => model.storeWizard
      ? [{ ...model, storeWizard: null }, []]
      : [{ ...model, storeWizard: createWizardState(), palette: null }, []],
    'overlay-close': () => closeOverlay(model),
  };
  return action.type in handlers ? handlers[action.type]() : null;
}

/**
 * Handle non-overlay layout and navigation actions.
 *
 * @param {DashAction} action
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]] | null}
 */
function handleLayoutAction(action, model) {
  if (action.type === 'filter-start') {
    return startFilter(model);
  }
  if (action.type === 'scroll-detail') {
    if (!model.detailPager) {
      return [model, []];
    }
    return [{ ...model, detailPager: pagerScrollBy(model.detailPager, action.delta) }, []];
  }
  if (action.type === 'page-detail') {
    if (!model.detailPager) {
      return [model, []];
    }
    const pager = action.delta > 0 ? pagerPageDown(model.detailPager) : pagerPageUp(model.detailPager);
    return [{ ...model, detailPager: pager }, []];
  }
  return null;
}

/**
 * Return true when explorer-only actions should be ignored in treemap view.
 *
 * @param {DashAction} action
 * @returns {boolean}
 */
function isBlockedByTreemapView(action) {
  return action.type === 'move'
    || action.type === 'page'
    || action.type === 'select'
    || action.type === 'filter-start'
    || action.type === 'scroll-detail'
    || action.type === 'page-detail';
}

/**
 * Handle the primary keymap actions that do not require further routing.
 *
 * @param {DashAction} action
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]] | null}
 */
function handlePrimaryAction(action, model, deps) {
  if (action.type === 'quit') {
    if (model.quitConfirm) {
      return [model, [quit()]];
    }
    return [{ ...model, quitConfirm: true }, []];
  }
  if (action.type === 'move') {
    return handleMove(action, model, deps.ctx);
  }
  if (action.type === 'page') {
    return handlePage(action, model, deps.ctx);
  }
  if (action.type === 'select') {
    return handleSelect(model, deps);
  }
  return null;
}

/**
 * Handle keymap actions.
 *
 * @param {DashAction} action
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
/**
 * Handle accordion navigation within the detail pane.
 *
 * @param {DashAction} action
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]] | null}
 */
function handleDetailAccordionAction(action, model) {
  if (!model.detailAccordion) {
    return null;
  }
  if (action.type === 'move') {
    const next = action.delta > 0
      ? accordionFocusNext(model.detailAccordion)
      : accordionFocusPrev(model.detailAccordion);
    return [{ ...model, detailAccordion: next }, []];
  }
  if (action.type === 'select' || action.type === 'accordion-toggle') {
    return [{ ...model, detailAccordion: accordionToggleFocused(model.detailAccordion) }, []];
  }
  return null;
}

function handleDetailPaneAction(action, model) {
  if (model.activeDrawer || model.viewMode !== 'detail') {
    return null;
  }
  const accordionResult = handleDetailAccordionAction(action, model);
  if (accordionResult) {
    return accordionResult;
  }
  if (action.type === 'move') {
    return handleLayoutAction({ type: 'scroll-detail', delta: action.delta }, model) ?? [model, []];
  }
  if (action.type === 'page') {
    return handleLayoutAction({ type: 'page-detail', delta: action.delta }, model) ?? [model, []];
  }
  return null;
}

function handleAction(action, model, deps) {
  const dagResult = handleDagAction(action, model, deps);
  if (dagResult) {
    return dagResult;
  }
  const refsResult = handleRefsViewAction(action, model, deps);
  if (refsResult) {
    return refsResult;
  }
  const treemapResult = handleTreemapViewAction(action, model, deps);
  if (treemapResult) {
    return treemapResult;
  }
  if (model.activeDrawer === 'treemap' && isBlockedByTreemapView(action)) {
    return [model, []];
  }
  const detailResult = handleDetailPaneAction(action, model);
  if (detailResult) {
    return detailResult;
  }
  const primaryResult = handlePrimaryAction(action, model, deps);
  if (primaryResult) {
    return primaryResult;
  }
  const overlayResult = handleOverlayAction(action, model, deps);
  if (overlayResult) { return overlayResult; }
  const layoutResult = handleLayoutAction(action, model);
  if (layoutResult) { return layoutResult; }
  return [model, []];
}

/**
 * Handle successful report loads.
 *
 * @param {DashMsg} msg
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function handleLoadedReport(msg, model) {
  if (msg.type === 'loaded-refs') {
    return handleLoadedRefs(msg, model);
  }
  if (msg.type === 'loaded-stats') {
    return handleLoadedStats(msg, model);
  }
  if (msg.type === 'loaded-doctor') {
    return handleLoadedDoctor(msg, model);
  }
  if (msg.type === 'loaded-treemap') {
    return handleLoadedTreemap(msg, model);
  }
  return [model, []];
}

/**
 * Store a loaded refs inventory.
 *
 * @param {Extract<DashMsg, { type: 'loaded-refs' }>} msg
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function handleLoadedRefs(msg, model) {
  return [{
    ...model,
    refsStatus: 'ready',
    refsItems: msg.refs.refs,
    refsError: null,
    refsTable: syncRefsTable(model.refsTable, {
      refs: msg.refs.refs,
      rows: model.rows,
      focusRow: 0,
      scrollY: 0,
    }),
  }, []];
}

/**
 * Store a loaded stats report if it still matches the active source.
 *
 * @param {Extract<DashMsg, { type: 'loaded-stats' }>} msg
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function handleLoadedStats(msg, model) {
  if (!sourceEquals(msg.source, model.source)) {
    return [model, []];
  }
  return [{
    ...model,
    statsStatus: 'ready',
    statsReport: msg.stats,
    statsError: null,
  }, []];
}

/**
 * Store a loaded doctor report if it still matches the active source.
 *
 * @param {Extract<DashMsg, { type: 'loaded-doctor' }>} msg
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function handleLoadedDoctor(msg, model) {
  if (!sourceEquals(msg.source, model.source)) {
    return [model, []];
  }
  return [{
    ...model,
    doctorStatus: 'ready',
    doctorReport: msg.report,
    doctorError: null,
  }, []];
}

/**
 * Store a loaded treemap report if it still matches the active view state.
 *
 * @param {Extract<DashMsg, { type: 'loaded-treemap' }>} msg
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function handleLoadedTreemap(msg, model) {
  if (!treemapReportMatches(model, msg.report)) {
    return [model, []];
  }
  return [{
    ...model,
    treemapStatus: 'ready',
    treemapReport: msg.report,
    treemapError: null,
    treemapFocus: clampTreemapFocus(model.treemapFocus, msg.report.tiles ?? []),
  }, []];
}

/**
 * Handle load errors from async dashboard commands.
 *
 * @param {DashMsg & { type: 'load-error' }} msg
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function handleLoadError(msg, model) {
  if (isStaleSourceLoad(msg, model)) {
    return [model, []];
  }
  if (msg.source === 'treemap' && isStaleTreemapLoad(msg, model)) {
    return [model, []];
  }
  return addToast(applyLoadErrorState(msg, model), {
    level: 'error',
    title: loadErrorTitle(msg),
    message: msg.error,
  });
}

/**
 * Handle app-level messages (data loading results).
 *
 * @param {DashMsg} msg
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
/**
 * Handle auth and wizard lifecycle messages.
 *
 * @param {DashMsg} msg
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]] | null}
 */
function handleLifecycleMsg(msg, model, deps) {
  if (msg.type === 'vault-auth-check') { return handleVaultAuthCheck(msg, model, deps); }
  if (msg.type === 'vault-auth-ok') { return handleVaultAuthOk(model, deps); }
  if (msg.type === 'vault-auth-fail') { return [{ ...model, authError: msg.error, passphrase: '' }, []]; }
  if (msg.type === 'wizard-store-done') { return handleWizardDone(msg, model, deps); }
  if (msg.type === 'wizard-store-error') { return handleWizardError(msg, model); }
  return null;
}

function handleTickMsg(msg, model) {
  if (msg.type === 'notification-tick') {
    const notifications = tickNotifications(model.notifications, Date.now());
    return [{ ...model, notifications }, notificationTickCmds(notifications)];
  }
  if (model.phase !== 'title' && model.phase !== 'password') { return [model, []]; }
  return [{ ...model, titleTimeMs: (model.titleTimeMs || 0) + 33 }, [/** @type {DashCmd} */ (tick(33, { type: 'title-tick' }))]];
}

function handleAppMsg(msg, model, deps) {
  if (msg.type === 'loaded-entries') { return handleLoadedEntries(msg, model, deps.cas); }
  if (msg.type === 'loaded-manifest') { return handleLoadedManifest(msg, model, deps.ctx); }
  if (msg.type === 'loaded-branch') { return [{ ...model, gitBranch: msg.branch }, []]; }
  if (msg.type === 'notification-tick' || msg.type === 'title-tick') { return handleTickMsg(msg, model); }
  const lifecycle = handleLifecycleMsg(msg, model, deps);
  if (lifecycle) { return lifecycle; }
  if (msg.type === 'load-error') { return handleLoadError(msg, model); }
  return handleLoadedReport(msg, model);
}

/**
 * Handle a successful store wizard completion.
 *
 * @param {{ type: 'wizard-store-done', slug: string }} msg
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function handleWizardDone(msg, model, deps) {
  const notifications = pushNotification(model.notifications, {
    body: `Stored ${msg.slug}`,
    variant: 'success',
    dismissAfterMs: 4000,
  });
  return [{
    ...model,
    storeWizard: null,
    notifications,
  }, [loadEntriesCmd(deps.cas, model.source), ...notificationTickCmds(notifications)]];
}

/**
 * Handle a store wizard error.
 *
 * @param {{ type: 'wizard-store-error', error: string }} msg
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function handleWizardError(msg, model) {
  const notifications = pushNotification(model.notifications, {
    body: `Store failed: ${msg.error}`,
    variant: 'error',
    dismissAfterMs: 6000,
  });
  return [{
    ...model,
    storeWizard: null,
    notifications,
  }, notificationTickCmds(notifications)];
}

/**
 * Normalize punctuation key runtime differences across terminals.
 *
 * Bijou's descriptor parser can match `shift+=`, but some live terminals emit
 * the printable `+` and `_` characters directly instead of the unshifted key
 * plus a modifier flag. Accept both representations for treemap drill keys.
 *
 * @param {KeyMsg} msg
 * @returns {DashAction | undefined}
 */
function runtimeSymbolAction(msg) {
  if (msg.ctrl || msg.alt) {
    return undefined;
  }
  if (msg.key === '+' || (msg.key === '=' && msg.shift)) {
    return { type: 'treemap-drill-in' };
  }
  if (msg.key === '-' || msg.key === '_') {
    return { type: 'treemap-drill-out' };
  }
  return undefined;
}

/**
 * Route all update messages to the appropriate handler.
 *
 * @param {KeyMsg | ResizeMsg | DashMsg} msg
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
/**
 * Route key messages to the correct handler based on active mode.
 *
 * @param {KeyMsg} msg
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
/**
 * Handle key events in modal states (quit confirm, palette, filter, wizard, dag).
 *
 * @param {KeyMsg} msg
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]] | null}
 */
function handleModalKey(msg, model, deps) {
  if (model.quitConfirm) {
    return (msg.key === 'q' || msg.key === 'y') ? [model, [quit()]] : [{ ...model, quitConfirm: false }, []];
  }
  if (model.palette) { return handlePaletteKey(msg, model, deps); }
  if (model.filtering) { return handleFilterKey(msg, model); }
  if (model.storeWizard) { return handleWizardKey(msg, model, deps); }
  if (model.dagPane) { return handleDagKey(msg, model, deps); }
  return null;
}

function handleKeyMsg(msg, model, deps) {
  if (model.phase === 'title') { return handleTitleKey(msg, model); }
  if (model.phase === 'password') { return handlePasswordKey(msg, model, deps); }
  const modal = handleModalKey(msg, model, deps);
  if (modal) { return modal; }
  const action = runtimeSymbolAction(msg) ?? deps.keyMap.handle(msg);
  if (action) { return handleAction(action, model, deps); }
  return [model, []];
}

function handleUpdate(msg, model, deps) {
  if (msg.type === 'key') {
    return handleKeyMsg(msg, model, deps);
  }
  if (msg.type === 'resize') {
    return handleResize(msg, model);
  }
  return handleAppMsg(/** @type {DashMsg} */ (msg), model, deps);
}

/**
 * Handle terminal resize events.
 *
 * @param {ResizeMsg} msg
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function handleResize(msg, model) {
  const table = syncTable(model.table, {
    entries: model.filtered,
    manifestCache: model.manifestCache,
    rows: msg.rows,
  });
  const refsTable = syncRefsTable(model.refsTable, {
    refs: model.refsItems,
    rows: msg.rows,
  });
  const palette = model.palette
    ? {
      ...model.palette,
      height: paletteHeight(msg.rows),
    }
    : null;
  const detailPager = model.detailPager
    ? { ...model.detailPager, height: detailPagerHeight(msg.rows) }
    : null;
  return [{ ...model, columns: msg.columns, rows: msg.rows, table, refsTable, palette, detailPager }, []];
}

/**
 * Return true when a treemap report matches the current view state.
 *
 * @param {{ treemapScope: TreemapScope, treemapWorktreeMode: TreemapWorktreeMode }} model
 * @param {{ scope?: TreemapScope, worktreeMode?: TreemapWorktreeMode } | null | undefined} report
 * @returns {boolean}
 */
function treemapReportMatches(model, report) {
  if (!report || report.scope !== model.treemapScope || !sourceEquals(report.source, model.source) || !treemapPathEquals(report.drillPath ?? [], model.treemapPath)) {
    return false;
  }
  if (report.scope !== 'repository') {
    return true;
  }
  return report.worktreeMode === model.treemapWorktreeMode;
}

/**
 * Create the TEA app object for the dashboard.
 *
 * @param {DashDeps} deps
 * @returns {import('@flyingrobots/bijou-tui').App<DashModel, DashMsg>}
 */
export function createDashboardApp(deps) {
  return {
    init: () => /** @type {[DashModel, DashCmd[]]} */ ([createInitModel(deps.ctx, deps.source), [/** @type {DashCmd} */ (checkVaultAuthCmd(deps.cas, deps.source))]]),
    update: (/** @type {KeyMsg | ResizeMsg | DashMsg} */ msg, /** @type {DashModel} */ model) => handleUpdate(msg, model, deps),
    view: (/** @type {DashModel} */ model) => renderDashboard(model, deps),
  };
}

/**
 * Print static list for non-TTY environments.
 *
 * @param {ContentAddressableStore} cas Content-addressable store read by printStaticList.
 * @param {DashSource} source Dashboard source used by printStaticList to choose entries.
 * @param {Pick<NodeJS.WriteStream, 'write'> | NodeJS.WriteStream} [output=process.stdout] Output stream used by printStaticList to write each entry.
 */
async function printStaticList(cas, source, output = process.stdout) {
  const { entries } = await readSourceEntries(cas, source);
  for (const { slug, treeOid } of entries) {
    output.write(`${slug}\t${treeOid}\n`);
  }
}

/**
 * Ensure launchDashboard has a mode before branching on interactive behavior.
 *
 * @param {BijouContext} ctx
 * @returns {BijouContext}
 */
function normalizeLaunchContext(ctx) {
  const candidate = /** @type {BijouContext & { mode?: import('@flyingrobots/bijou').OutputMode }} */ (ctx);
  if (candidate.mode) {
    return candidate;
  }
  if (!candidate.runtime) {
    throw new TypeError('launchDashboard requires ctx.runtime when ctx.mode is absent');
  }
  return {
    ...candidate,
    mode: detectCliTuiMode(candidate.runtime),
  };
}

/**
 * Launch the interactive vault dashboard.
 *
 * @param {ContentAddressableStore} cas
 * @param {{
 *   ctx?: BijouContext,
 *   runApp?: typeof startApp,
 *   cwd?: string,
 *   source?: DashSource,
 *   output?: Pick<NodeJS.WriteStream, 'write'>,
 * }} [options]
 */
export async function launchDashboard(cas, options = {}) {
  const ctx = options.ctx ? normalizeLaunchContext(options.ctx) : createCliTuiContext();
  const source = options.source ?? { type: 'vault' };
  if (ctx.mode !== 'interactive') {
    return printStaticList(cas, source, options.output);
  }
  const keyMap = createKeyBindings();
  const deps = { keyMap, cas, ctx, cwdLabel: options.cwd, source };
  const runApp = options.runApp || startApp;
  return runApp(createDashboardApp(deps), { ctx });
}
