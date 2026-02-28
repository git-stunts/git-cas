/**
 * TEA app shell for the vault dashboard.
 */

import { run, quit, createKeyMap } from '@flyingrobots/bijou-tui';
import { createNodeContext } from '@flyingrobots/bijou-node';
import { loadEntriesCmd, loadManifestCmd } from './dashboard-cmds.js';
import { renderDashboard } from './dashboard-view.js';

/**
 * @typedef {import('@flyingrobots/bijou').BijouContext} BijouContext
 * @typedef {import('@flyingrobots/bijou-tui').KeyMsg} KeyMsg
 * @typedef {import('@flyingrobots/bijou-tui').ResizeMsg} ResizeMsg
 * @typedef {import('@flyingrobots/bijou-tui').Cmd<DashMsg>} DashCmd
 * @typedef {import('@flyingrobots/bijou-tui').KeyMap<DashAction>} DashKeyMap
 * @typedef {import('../../index.js').default} ContentAddressableStore
 * @typedef {import('../../src/domain/value-objects/Manifest.js').default} Manifest
 * @typedef {{ slug: string, treeOid: string }} VaultEntry
 */

/**
 * @typedef {{ type: 'quit' }
 *   | { type: 'move', delta: number }
 *   | { type: 'select' }
 *   | { type: 'filter-start' }
 *   | { type: 'scroll-detail', delta: number }
 * } DashAction
 */

/**
 * @typedef {{ type: 'loaded-entries', entries: VaultEntry[], metadata: any }
 *   | { type: 'loaded-manifest', slug: string, manifest: Manifest }
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
 * @property {number} cursor
 * @property {string} filterText
 * @property {boolean} filtering
 * @property {any} metadata
 * @property {Map<string, Manifest>} manifestCache
 * @property {string | null} loadingSlug
 * @property {number} detailScroll
 * @property {string | null} error
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
    .bind('enter', 'Load', { type: 'select' })
    .bind('/', 'Filter', { type: 'filter-start' })
    .bind('shift+j', 'Scroll down', { type: 'scroll-detail', delta: 3 })
    .bind('shift+k', 'Scroll up', { type: 'scroll-detail', delta: -3 });
}

/**
 * Create the initial model.
 *
 * @returns {DashModel}
 */
function createInitModel() {
  return {
    status: 'loading',
    columns: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
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
  const cursor = Math.max(0, Math.min(model.cursor, filtered.length - 1));
  const cmds = /** @type {DashCmd[]} */ (msg.entries.map((/** @type {VaultEntry} */ e) => loadManifestCmd(cas, e.slug, e.treeOid)));
  return [{
    ...model,
    status: 'ready',
    entries: msg.entries,
    filtered,
    cursor,
    metadata: msg.metadata,
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
  return [{ ...model, manifestCache: cache }, []];
}

/**
 * Handle cursor movement.
 *
 * @param {{ type: 'move', delta: number }} msg
 * @param {DashModel} model
 * @returns {[DashModel, DashCmd[]]}
 */
function handleMove(msg, model) {
  const max = model.filtered.length - 1;
  const cursor = Math.max(0, Math.min(max, model.cursor + msg.delta));
  return [{ ...model, cursor, detailScroll: 0 }, []];
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
    return [{ ...model, filterText: text, filtered, cursor: 0 }, []];
  }
  if (msg.key.length === 1) {
    const text = model.filterText + msg.key;
    const filtered = applyFilter(model.entries, text);
    return [{ ...model, filterText: text, filtered, cursor: 0 }, []];
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
  const entry = model.filtered[model.cursor];
  if (!entry || model.manifestCache.has(entry.slug)) {
    return [model, []];
  }
  const cmd = /** @type {DashCmd} */ (loadManifestCmd(deps.cas, entry.slug, entry.treeOid));
  return [{ ...model, loadingSlug: entry.slug }, [cmd]];
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
  if (action.type === 'filter-start') {
    return [{ ...model, filtering: true, filterText: '', filtered: model.entries, cursor: 0 }, []];
  }
  if (action.type === 'scroll-detail') {
    const scroll = Math.max(0, model.detailScroll + action.delta);
    return [{ ...model, detailScroll: scroll }, []];
  }
  if (action.type === 'select') { return handleSelect(model, deps); }
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
  if (msg.type === 'load-error') {
    if (msg.source === 'manifest') {
      return [model, []];
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
  if (msg.type === 'key' && model.filtering) {
    return handleFilterKey(msg, model);
  }
  if (msg.type === 'key') {
    const action = deps.keyMap.handle(msg);
    if (action) { return handleAction(action, model, deps); }
    return [model, []];
  }
  if (msg.type === 'resize') {
    return [{ ...model, columns: msg.columns, rows: msg.rows }, []];
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
    init: () => /** @type {[DashModel, DashCmd[]]} */ ([createInitModel(), [/** @type {DashCmd} */ (loadEntriesCmd(deps.cas))]]),
    update: (/** @type {KeyMsg | ResizeMsg | DashMsg} */ msg, /** @type {DashModel} */ model) => handleUpdate(msg, model, deps),
    view: (/** @type {DashModel} */ model) => renderDashboard(model, deps),
  };
}

/**
 * Print static list for non-TTY environments.
 *
 * @param {ContentAddressableStore} cas
 */
async function printStaticList(cas) {
  const entries = await cas.listVault();
  for (const { slug, treeOid } of entries) {
    process.stdout.write(`${slug}\t${treeOid}\n`);
  }
}

/**
 * Launch the interactive vault dashboard.
 *
 * @param {ContentAddressableStore} cas
 */
export async function launchDashboard(cas) {
  if (!process.stdout.isTTY) {
    return printStaticList(cas);
  }
  const ctx = createNodeContext();
  const keyMap = createKeyBindings();
  const deps = { keyMap, cas, ctx };
  return run(createDashboardApp(deps), { ctx });
}
