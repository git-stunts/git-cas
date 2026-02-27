/**
 * TEA app shell for the vault dashboard.
 */

import { run, quit, createKeyMap } from '@flyingrobots/bijou-tui';
import { createNodeContext } from '@flyingrobots/bijou-node';
import { loadEntriesCmd, loadManifestCmd } from './dashboard-cmds.js';
import { renderDashboard } from './dashboard-view.js';

/**
 * Create keyboard bindings for normal mode.
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
 */
function applyFilter(entries, text) {
  if (!text) { return entries; }
  return entries.filter(e => e.slug.includes(text));
}

/**
 * Handle the loaded-entries message.
 */
function handleLoadedEntries(msg, model, cas) {
  const filtered = applyFilter(msg.entries, model.filterText);
  const cursor = Math.max(0, Math.min(model.cursor, filtered.length - 1));
  const cmds = msg.entries.map(e => loadManifestCmd(cas, e.slug, e.treeOid));
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
 */
function handleLoadedManifest(msg, model) {
  const cache = new Map(model.manifestCache);
  cache.set(msg.slug, msg.manifest);
  return [{ ...model, manifestCache: cache }, []];
}

/**
 * Handle cursor movement.
 */
function handleMove(msg, model) {
  const max = model.filtered.length - 1;
  const cursor = Math.max(0, Math.min(max, model.cursor + msg.delta));
  return [{ ...model, cursor, detailScroll: 0 }, []];
}

/**
 * Handle filter key input in filter mode.
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
 */
function handleSelect(model, deps) {
  const entry = model.filtered[model.cursor];
  if (!entry || model.manifestCache.has(entry.slug)) {
    return [model, []];
  }
  const cmd = loadManifestCmd(deps.cas, entry.slug, entry.treeOid);
  return [{ ...model, loadingSlug: entry.slug }, [cmd]];
}

/**
 * Handle keymap actions.
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
  return handleAppMsg(msg, model, deps.cas);
}

/**
 * Create the TEA app object for the dashboard.
 */
export function createDashboardApp(deps) {
  return {
    init: () => [createInitModel(), [loadEntriesCmd(deps.cas)]],
    update: (msg, model) => handleUpdate(msg, model, deps),
    view: (model) => renderDashboard(model, deps),
  };
}

/**
 * Print static list for non-TTY environments.
 */
async function printStaticList(cas) {
  const entries = await cas.listVault();
  for (const { slug, treeOid } of entries) {
    process.stdout.write(`${slug}\t${treeOid}\n`);
  }
}

/**
 * Launch the interactive vault dashboard.
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
