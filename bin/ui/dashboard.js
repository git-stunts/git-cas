/**
 * TEA app shell for the vault dashboard.
 */

import {
  run, quit, createKeyMap,
  createNavigableTableState, navTableFocusNext, navTableFocusPrev, navTablePageDown, navTablePageUp,
  createSplitPaneState, splitPaneFocusNext, splitPaneResizeBy,
  createCommandPaletteState, cpFilter, cpFocusNext, cpFocusPrev, cpPageDown, cpPageUp, cpSelectedItem, commandPaletteKeyMap,
} from '@flyingrobots/bijou-tui';
import { loadEntriesCmd, loadManifestCmd, loadStatsCmd, loadDoctorCmd } from './dashboard-cmds.js';
import { createCliTuiContext, detectCliTuiMode } from './context.js';
import { renderDashboard } from './dashboard-view.js';

/**
 * @typedef {import('@flyingrobots/bijou').BijouContext} BijouContext
 * @typedef {import('@flyingrobots/bijou-tui').KeyMsg} KeyMsg
 * @typedef {import('@flyingrobots/bijou-tui').ResizeMsg} ResizeMsg
 * @typedef {import('@flyingrobots/bijou-tui').Cmd<DashMsg>} DashCmd
 * @typedef {import('@flyingrobots/bijou-tui').KeyMap<DashAction>} DashKeyMap
 * @typedef {import('@flyingrobots/bijou-tui').NavigableTableState} NavigableTableState
 * @typedef {import('@flyingrobots/bijou-tui').SplitPaneState} SplitPaneState
 * @typedef {import('@flyingrobots/bijou-tui').CommandPaletteState} CommandPaletteState
 * @typedef {import('../../index.js').default} ContentAddressableStore
 * @typedef {import('../../src/domain/value-objects/Manifest.js').default} Manifest
 * @typedef {{ slug: string, treeOid: string }} VaultEntry
 * @typedef {'idle' | 'loading' | 'ready' | 'error'} LoadState
 */

/**
 * @typedef {{ type: 'quit' }
 *   | { type: 'move', delta: number }
 *   | { type: 'page', delta: number }
 *   | { type: 'select' }
 *   | { type: 'filter-start' }
 *   | { type: 'scroll-detail', delta: number }
 *   | { type: 'split-focus' }
 *   | { type: 'split-resize', delta: number }
 *   | { type: 'open-palette' }
 *   | { type: 'open-stats' }
 *   | { type: 'open-doctor' }
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
 * @typedef {{ type: 'loaded-entries', entries: VaultEntry[], metadata: any }
 *   | { type: 'loaded-manifest', slug: string, manifest: Manifest }
 *   | { type: 'loaded-stats', stats: any }
 *   | { type: 'loaded-doctor', report: any }
 *   | { type: 'load-error', source: string, slug?: string, error: string }
 * } DashMsg
 */

/**
 * @typedef {Object} DashModel
 * @property {string} status
 * @property {number} columns
 * @property {number} rows
 * @property {VaultEntry[]} entries
 * @property {VaultEntry[]} filtered
 * @property {string} filterText
 * @property {boolean} filtering
 * @property {any} metadata
 * @property {Map<string, Manifest>} manifestCache
 * @property {string | null} loadingSlug
 * @property {number} detailScroll
 * @property {string | null} error
 * @property {NavigableTableState} table
 * @property {SplitPaneState} splitPane
 * @property {CommandPaletteState | null} palette
 * @property {'stats' | 'doctor' | null} activeDrawer
 * @property {LoadState} statsStatus
 * @property {any | null} statsReport
 * @property {string | null} statsError
 * @property {LoadState} doctorStatus
 * @property {any | null} doctorReport
 * @property {string | null} doctorError
 */

/**
 * @typedef {Object} DashDeps
 * @property {DashKeyMap} keyMap
 * @property {ContentAddressableStore} cas
 * @property {BijouContext} ctx
 */

/**
 * Create keyboard bindings for normal mode.
 *
 * @returns {DashKeyMap}
 */
export function createKeyBindings() {
  return createKeyMap()
    .bind('q', 'Quit', { type: 'quit' })
    .bind('j', 'Down', { type: 'move', delta: 1 })
    .bind('down', 'Down', { type: 'move', delta: 1 })
    .bind('k', 'Up', { type: 'move', delta: -1 })
    .bind('up', 'Up', { type: 'move', delta: -1 })
    .bind('d', 'Page down', { type: 'page', delta: 1 })
    .bind('pagedown', 'Page down', { type: 'page', delta: 1 })
    .bind('u', 'Page up', { type: 'page', delta: -1 })
    .bind('pageup', 'Page up', { type: 'page', delta: -1 })
    .bind('enter', 'Load', { type: 'select' })
    .bind('/', 'Filter', { type: 'filter-start' })
    .bind('tab', 'Focus pane', { type: 'split-focus' })
    .bind('shift+h', 'Narrow pane', { type: 'split-resize', delta: -4 })
    .bind('shift+l', 'Widen pane', { type: 'split-resize', delta: 4 })
    .bind('ctrl+p', 'Palette', { type: 'open-palette' })
    .bind(':', 'Palette', { type: 'open-palette' })
    .bind('s', 'Stats', { type: 'open-stats' })
    .bind('g', 'Doctor', { type: 'open-doctor' })
    .bind('escape', 'Close overlay', { type: 'overlay-close' })
    .bind('shift+j', 'Scroll down', { type: 'scroll-detail', delta: 3 })
    .bind('shift+k', 'Scroll up', { type: 'scroll-detail', delta: -3 });
}

const TABLE_COLUMNS = [
  { header: 'Slug', width: 20 },
  { header: 'Size', width: 8, align: 'right' },
  { header: 'Chunks', width: 6, align: 'right' },
  { header: 'Crypto', width: 7 },
  { header: 'Format', width: 10 },
  { header: 'Profile', width: 12 },
];

const DASH_HEADER_ROWS = 3;
const DASH_FOOTER_ROWS = 4;
const PANE_BORDER_ROWS = 2;
const LIST_META_ROWS = 2;
const SPLIT_MIN_LIST_WIDTH = 28;
const SPLIT_MIN_DETAIL_WIDTH = 32;
const SPLIT_DIVIDER_SIZE = 1;

const PALETTE_ITEMS = [
  {
    id: 'stats',
    label: 'Open Vault Stats',
    description: 'Logical size, dedup ratio, encryption coverage',
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
    id: 'focus-entries',
    label: 'Focus Entries Pane',
    description: 'Move focus back to the explorer table',
    category: 'Pane',
    shortcut: 'tab',
  },
  {
    id: 'focus-inspector',
    label: 'Focus Inspector Pane',
    description: 'Move focus to the manifest inspector',
    category: 'Pane',
  },
  {
    id: 'close-drawer',
    label: 'Close Active Drawer',
    description: 'Dismiss the stats or doctor overlay',
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

/**
 * Create the initial model.
 *
 * @param {BijouContext} ctx
 * @returns {DashModel}
 */
function createInitModel(ctx) {
  const table = createNavigableTableState({
    columns: TABLE_COLUMNS,
    rows: [],
    height: tableHeight(ctx.runtime.rows ?? 24),
  });
  return {
    status: 'loading',
    columns: ctx.runtime.columns ?? 80,
    rows: ctx.runtime.rows ?? 24,
    entries: [],
    filtered: [],
    filterText: '',
    filtering: false,
    metadata: null,
    manifestCache: new Map(),
    loadingSlug: null,
    detailScroll: 0,
    error: null,
    table,
    splitPane: createSplitPaneState({ ratio: 0.37, focused: 'a' }),
    palette: null,
    activeDrawer: null,
    statsStatus: 'idle',
    statsReport: null,
    statsError: null,
    doctorStatus: 'idle',
    doctorReport: null,
    doctorError: null,
  };
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
 * Handle the loaded-entries message.
 *
 * @param {DashMsg & { type: 'loaded-entries' }} msg
 * @param {DashModel} model
 * @param {ContentAddressableStore} cas
 * @returns {[DashModel, DashCmd[]]}
 */
function handleLoadedEntries(msg, model, cas) {
  const filtered = applyFilter(msg.entries, model.filterText);
  const table = syncTable(model.table, {
    entries: filtered,
    manifestCache: model.manifestCache,
    rows: model.rows,
  });
  const cmds = /** @type {DashCmd[]} */ (msg.entries.map((/** @type {VaultEntry} */ e) => loadManifestCmd(cas, e.slug, e.treeOid)));
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
 * @returns {[DashModel, DashCmd[]]}
 */
function handleLoadedManifest(msg, model) {
  const cache = new Map(model.manifestCache);
  cache.set(msg.slug, msg.manifest);
  const table = syncTable(model.table, {
    entries: model.filtered,
    manifestCache: cache,
    rows: model.rows,
  });
  return [{
    ...model,
    manifestCache: cache,
    loadingSlug: model.loadingSlug === msg.slug ? null : model.loadingSlug,
    table,
  }, []];
}

/**
 * Handle cursor movement.
 *
 * @param {{ type: 'move', delta: number }} msg
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function handleMove(msg, model) {
  const table = msg.delta > 0 ? navTableFocusNext(model.table) : navTableFocusPrev(model.table);
  return [{ ...model, table, detailScroll: 0 }, []];
}

/**
 * Handle page-wise table navigation.
 *
 * @param {{ type: 'page', delta: number }} msg
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function handlePage(msg, model) {
  const table = msg.delta > 0 ? navTablePageDown(model.table) : navTablePageUp(model.table);
  return [{ ...model, table, detailScroll: 0 }, []];
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
    const filtered = applyFilter(model.entries, text);
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
    const filtered = applyFilter(model.entries, text);
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
  const entry = model.filtered[model.table.focusRow];
  if (!entry) {
    return [model, []];
  }
  if (model.manifestCache.has(entry.slug)) {
    return [{ ...model, splitPane: { ...model.splitPane, focused: 'b' } }, []];
  }
  const cmd = /** @type {DashCmd} */ (loadManifestCmd(deps.cas, entry.slug, entry.treeOid));
  return [{
    ...model,
    loadingSlug: entry.slug,
    splitPane: { ...model.splitPane, focused: 'b' },
  }, [cmd]];
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
  }, [/** @type {DashCmd} */ (loadStatsCmd(deps.cas))]];
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
  }, [/** @type {DashCmd} */ (loadDoctorCmd(deps.cas))]];
}

/**
 * Close the command palette or active drawer, whichever is visible.
 *
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function closeOverlay(model) {
  if (model.palette) {
    return [{ ...model, palette: null }, []];
  }
  if (model.activeDrawer) {
    return [{ ...model, activeDrawer: null }, []];
  }
  return [model, []];
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
  if (item.id === 'stats') {
    return openStatsDrawer(model, deps);
  }
  if (item.id === 'doctor') {
    return openDoctorDrawer(model, deps);
  }
  if (item.id === 'focus-entries') {
    return [{
      ...model,
      palette: null,
      splitPane: { ...model.splitPane, focused: 'a' },
    }, []];
  }
  if (item.id === 'focus-inspector') {
    return [{
      ...model,
      palette: null,
      splitPane: { ...model.splitPane, focused: 'b' },
    }, []];
  }
  if (item.id === 'close-drawer') {
    return [{
      ...model,
      palette: null,
      activeDrawer: null,
    }, []];
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
 * Resize the currently focused split pane.
 *
 * @param {DashModel} model
 * @param {number} delta
 * @returns {[DashModel, DashCmd[]]}
 */
function resizeSplitPane(model, delta) {
  const signedDelta = model.splitPane.focused === 'a' ? delta : -delta;
  const splitPane = splitPaneResizeBy(model.splitPane, signedDelta, {
    total: model.columns,
    minA: SPLIT_MIN_LIST_WIDTH,
    minB: SPLIT_MIN_DETAIL_WIDTH,
    dividerSize: SPLIT_DIVIDER_SIZE,
  });
  return [{ ...model, splitPane }, []];
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
  if (action.type === 'open-palette') {
    return setPalette(model, createPalette(model.rows));
  }
  if (action.type === 'open-stats') {
    return openStatsDrawer(model, deps);
  }
  if (action.type === 'open-doctor') {
    return openDoctorDrawer(model, deps);
  }
  if (action.type === 'overlay-close') {
    return closeOverlay(model);
  }
  return null;
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
    const scroll = Math.max(0, model.detailScroll + action.delta);
    return [{ ...model, detailScroll: scroll }, []];
  }
  if (action.type === 'split-focus') {
    return [{ ...model, splitPane: splitPaneFocusNext(model.splitPane) }, []];
  }
  if (action.type === 'split-resize') {
    return resizeSplitPane(model, action.delta);
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
function handleAction(action, model, deps) {
  if (action.type === 'quit') { return [model, [quit()]]; }
  if (action.type === 'move') { return handleMove(action, model); }
  if (action.type === 'page') { return handlePage(action, model); }
  if (action.type === 'select') { return handleSelect(model, deps); }
  const overlayResult = handleOverlayAction(action, model, deps);
  if (overlayResult) { return overlayResult; }
  const layoutResult = handleLayoutAction(action, model);
  if (layoutResult) { return layoutResult; }
  return [model, []];
}

/**
 * Handle app-level messages (data loading results).
 *
 * @param {DashMsg} msg
 * @param {DashModel} model
 * @param {ContentAddressableStore} cas
 * @returns {[DashModel, DashCmd[]]}
 */
function handleAppMsg(msg, model, cas) {
  if (msg.type === 'loaded-entries') { return handleLoadedEntries(msg, model, cas); }
  if (msg.type === 'loaded-manifest') { return handleLoadedManifest(msg, model); }
  if (msg.type === 'loaded-stats') {
    return [{
      ...model,
      statsStatus: 'ready',
      statsReport: msg.stats,
      statsError: null,
    }, []];
  }
  if (msg.type === 'loaded-doctor') {
    return [{
      ...model,
      doctorStatus: 'ready',
      doctorReport: msg.report,
      doctorError: null,
    }, []];
  }
  if (msg.type === 'load-error') {
    if (msg.source === 'manifest') {
      return [{ ...model, loadingSlug: model.loadingSlug === msg.slug ? null : model.loadingSlug }, []];
    }
    if (msg.source === 'stats') {
      return [{
        ...model,
        statsStatus: 'error',
        statsError: msg.error,
      }, []];
    }
    if (msg.source === 'doctor') {
      return [{
        ...model,
        doctorStatus: 'error',
        doctorError: msg.error,
      }, []];
    }
    return [{ ...model, status: 'error', error: msg.error }, []];
  }
  return [model, []];
}

/**
 * Route all update messages to the appropriate handler.
 *
 * @param {KeyMsg | ResizeMsg | DashMsg} msg
 * @param {DashModel} model
 * @param {DashDeps} deps
 * @returns {[DashModel, DashCmd[]]}
 */
function handleUpdate(msg, model, deps) {
  if (msg.type === 'key' && model.palette) {
    return handlePaletteKey(msg, model, deps);
  }
  if (msg.type === 'key' && model.filtering) {
    return handleFilterKey(msg, model);
  }
  if (msg.type === 'key') {
    const action = deps.keyMap.handle(msg);
    if (action) { return handleAction(action, model, deps); }
    return [model, []];
  }
  if (msg.type === 'resize') {
    const table = syncTable(model.table, {
      entries: model.filtered,
      manifestCache: model.manifestCache,
      rows: msg.rows,
    });
    const palette = model.palette
      ? {
        ...model.palette,
        height: paletteHeight(msg.rows),
      }
      : null;
    return [{ ...model, columns: msg.columns, rows: msg.rows, table, palette }, []];
  }
  return handleAppMsg(/** @type {DashMsg} */ (msg), model, deps.cas);
}

/**
 * Create the TEA app object for the dashboard.
 *
 * @param {DashDeps} deps
 * @returns {import('@flyingrobots/bijou-tui').App<DashModel, DashMsg>}
 */
export function createDashboardApp(deps) {
  return {
    init: () => /** @type {[DashModel, DashCmd[]]} */ ([createInitModel(deps.ctx), [/** @type {DashCmd} */ (loadEntriesCmd(deps.cas))]]),
    update: (/** @type {KeyMsg | ResizeMsg | DashMsg} */ msg, /** @type {DashModel} */ model) => handleUpdate(msg, model, deps),
    view: (/** @type {DashModel} */ model) => renderDashboard(model, deps),
  };
}

/**
 * Print static list for non-TTY environments.
 *
 * @param {ContentAddressableStore} cas Content-addressable store read by printStaticList.
 * @param {Pick<NodeJS.WriteStream, 'write'> | NodeJS.WriteStream} [output=process.stdout] Output stream used by printStaticList to write each entry.
 */
async function printStaticList(cas, output = process.stdout) {
  const entries = await cas.listVault();
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
 *   runApp?: typeof run,
 *   output?: Pick<NodeJS.WriteStream, 'write'>,
 * }} [options]
 */
export async function launchDashboard(cas, options = {}) {
  const ctx = options.ctx ? normalizeLaunchContext(options.ctx) : createCliTuiContext();
  if (ctx.mode !== 'interactive') {
    return printStaticList(cas, options.output);
  }
  const keyMap = createKeyBindings();
  const deps = { keyMap, cas, ctx };
  const runApp = options.runApp || run;
  return runApp(createDashboardApp(deps), { ctx });
}
