/**
 * Async command factories for the vault dashboard.
 */

import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { buildVaultStats, inspectVaultHealth } from './vault-report.js';

/** @typedef {import('../../index.js').default} ContentAddressableStore */
/** @typedef {{ type: 'vault' } | { type: 'ref', ref: string } | { type: 'oid', treeOid: string }} DashSource */
/** @typedef {{ slug: string, treeOid: string }} ExplorerEntry */
/** @typedef {'repository' | 'source'} TreemapScope */
/** @typedef {'worktree' | 'git' | 'ref' | 'vault' | 'cas' | 'meta'} RepoTreemapKind */
/** @typedef {{ label: string, kind: RepoTreemapKind, value: number, detail: string }} RepoTreemapTile */
/** @typedef {{
 *   scope: TreemapScope,
 *   cwd: string,
 *   source: DashSource,
 *   totalValue: number,
 *   tiles: RepoTreemapTile[],
 *   notes: string[],
 *   summary: {
 *     bare: boolean,
 *     gitDir: string,
 *     worktreeItems: number,
 *     refNamespaces: number,
 *     refCount: number,
 *     vaultEntries: number,
 *     sourceEntries: number,
 *   }
 * }} RepoTreemapReport
 */

/**
 * Compact OID label for human-facing rows.
 *
 * @param {string} oid
 * @returns {string}
 */
function shortOid(oid) {
  return oid.slice(0, 12);
}

/**
 * Build a single-entry source result for direct CAS tree inspection.
 *
 * @param {string} slug
 * @param {string} treeOid
 * @returns {{ entries: ExplorerEntry[], metadata: any }}
 */
function singleEntrySource(slug, treeOid) {
  return {
    entries: [{ slug, treeOid }],
    metadata: null,
  };
}

/**
 * Format bytes as a compact human-readable string.
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) { return `${bytes}B`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)}K`; }
  if (bytes < 1024 * 1024 * 1024) { return `${(bytes / (1024 * 1024)).toFixed(1)}M`; }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

/**
 * Normalize a manifest into plain data.
 *
 * @param {any} manifest
 * @returns {any}
 */
function manifestData(manifest) {
  return manifest?.toJSON ? manifest.toJSON() : manifest;
}

/**
 * Resolve the true git-dir path for a non-bare working tree.
 *
 * Supports both regular repositories where `.git` is a directory and worktrees
 * where `.git` is a pointer file containing `gitdir: <path>`.
 *
 * @param {string} repoRoot
 * @returns {Promise<string>}
 */
async function resolveWorktreeGitDir(repoRoot) {
  const dotGitPath = path.join(repoRoot, '.git');
  try {
    const stat = await lstat(dotGitPath);
    if (stat.isDirectory()) {
      return dotGitPath;
    }
    if (!stat.isFile()) {
      return dotGitPath;
    }
    const raw = await readFile(dotGitPath, 'utf8');
    const match = raw.match(/^\s*gitdir:\s*(.+)\s*$/i);
    return match ? path.resolve(repoRoot, match[1]) : dotGitPath;
  } catch {
    return dotGitPath;
  }
}

/**
 * Read the Git repo root and git-dir paths for the current CAS plumbing.
 *
 * @param {{ cwd?: string, execute: ({ args }: { args: string[] }) => Promise<string> }} plumbing
 * @returns {Promise<{ cwd: string, gitDir: string, bare: boolean }>}
 */
async function resolveRepoInfo(plumbing) {
  const cwd = plumbing.cwd ?? process.cwd();
  const bareRaw = await plumbing.execute({ args: ['rev-parse', '--is-bare-repository'] });
  const bare = bareRaw.trim() === 'true';
  let repoRoot = cwd;
  if (!bare) {
    try {
      repoRoot = (await plumbing.execute({ args: ['rev-parse', '--show-toplevel'] })).trim();
    } catch {
      repoRoot = cwd;
    }
  }
  return {
    cwd: repoRoot,
    gitDir: bare ? repoRoot : await resolveWorktreeGitDir(repoRoot),
    bare,
  };
}

/**
 * Measure a filesystem path recursively without following symlinks.
 *
 * @param {string} targetPath
 * @returns {Promise<number>}
 */
async function measurePathBytes(targetPath) {
  let stat;
  try {
    stat = await lstat(targetPath);
  } catch {
    return 0;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return stat.size;
  }
  const entries = await readdir(targetPath, { withFileTypes: true });
  const childSizes = await Promise.all(entries.map((entry) => measurePathBytes(path.join(targetPath, entry.name))));
  return childSizes.reduce((sum, size) => sum + size, 0);
}

/**
 * Build semantic tiles from the direct children of a directory.
 *
 * @param {string} directory
 * @param {RepoTreemapKind} kind
 * @param {(name: string) => string} labelFor
 * @returns {Promise<RepoTreemapTile[]>}
 */
async function scanDirectoryTiles(directory, kind, labelFor) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const tiles = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    const value = await measurePathBytes(entryPath);
    return {
      label: labelFor(entry.name),
      kind,
      value: Math.max(1, value),
      detail: `${formatBytes(value)} on disk`,
    };
  }));

  return tiles
    .filter((tile) => tile.value > 0)
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
}

/**
 * Group refs by their top-level namespace.
 *
 * @param {{ execute: ({ args }: { args: string[] }) => Promise<string> }} plumbing
 * @returns {Promise<{ tiles: RepoTreemapTile[], totalRefs: number }>}
 */
async function readRefNamespaceTiles(plumbing) {
  let output = '';
  try {
    output = await plumbing.execute({ args: ['show-ref'] });
  } catch {
    return { tiles: [], totalRefs: 0 };
  }

  const namespaces = new Map();
  for (const line of output.split('\n').map((row) => row.trim()).filter(Boolean)) {
    const [, ref = ''] = line.split(' ');
    const parts = ref.split('/');
    const label = parts[0] === 'refs' && parts[1] ? `refs/${parts[1]}` : ref;
    namespaces.set(label, (namespaces.get(label) ?? 0) + 1);
  }

  const tiles = Array.from(namespaces.entries())
    .map(([label, count]) => ({
      label,
      kind: /** @type {const} */ ('ref'),
      value: Math.max(1, count * 4096),
      detail: `${count} refs`,
    }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));

  return {
    tiles,
    totalRefs: Array.from(namespaces.values()).reduce((sum, count) => sum + count, 0),
  };
}

/**
 * Load manifests for explorer entries so logical sizes can be summarized.
 *
 * @param {ContentAddressableStore} cas
 * @param {ExplorerEntry[]} entries
 * @returns {Promise<Array<ExplorerEntry & { manifest: any, size: number }>>}
 */
async function loadEntryRecords(cas, entries) {
  return Promise.all(entries.map(async (entry) => {
    const manifest = await cas.readManifest({ treeOid: entry.treeOid });
    const data = manifestData(manifest);
    return {
      ...entry,
      manifest,
      size: data.size ?? 0,
    };
  }));
}

/**
 * Convert logical CAS records into treemap tiles.
 *
 * @param {Array<ExplorerEntry & { manifest: any, size: number }>} records
 * @param {RepoTreemapKind} kind
 * @returns {RepoTreemapTile[]}
 */
function buildLogicalTiles(records, kind) {
  return records
    .map((record) => {
      const data = manifestData(record.manifest);
      const format = data.compression?.algorithm ?? 'raw';
      const crypto = data.encryption ? 'enc' : 'plain';
      return {
        label: record.slug,
        kind,
        value: Math.max(1, record.size),
        detail: `${formatBytes(record.size)} logical · ${data.chunks?.length ?? 0} chunks · ${crypto}/${format}`,
      };
    })
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
}

/**
 * Collapse low-value tiles into a single "other" bucket so the treemap stays legible.
 *
 * @param {RepoTreemapTile[]} tiles
 * @param {number} limit
 * @returns {RepoTreemapTile[]}
 */
function compactTiles(tiles, limit = 14) {
  if (tiles.length <= limit) {
    return tiles;
  }
  const kept = tiles.slice(0, limit - 1);
  const remainder = tiles.slice(limit - 1);
  const otherValue = remainder.reduce((sum, tile) => sum + tile.value, 0);
  kept.push({
    label: 'other',
    kind: 'meta',
    value: Math.max(1, otherValue),
    detail: `${remainder.length} smaller regions`,
  });
  return kept;
}

/**
 * Build a one-line aggregate tile for a source collection.
 *
 * @param {string} label
 * @param {RepoTreemapKind} kind
 * @param {Array<ExplorerEntry & { manifest: any, size: number }>} records
 * @returns {RepoTreemapTile | null}
 */
function aggregateLogicalTile(label, kind, records) {
  if (records.length === 0) {
    return null;
  }
  const total = records.reduce((sum, record) => sum + record.size, 0);
  return {
    label,
    kind,
    value: Math.max(1, total),
    detail: `${records.length} entries · ${formatBytes(total)} logical`,
  };
}

/**
 * Build the source-focused treemap report.
 *
 * @param {{
 *   repo: { cwd: string, gitDir: string, bare: boolean },
 *   source: DashSource,
 *   sourceResult: { entries: ExplorerEntry[] },
 *   sourceRecords: Array<ExplorerEntry & { manifest: any, size: number }>,
 * }} options
 * @returns {RepoTreemapReport}
 */
function buildSourceScopeReport({ repo, source, sourceResult, sourceRecords }) {
  const sourceTiles = compactTiles(buildLogicalTiles(sourceRecords, source.type === 'vault' ? 'vault' : 'cas'));
  const totalValue = sourceTiles.reduce((sum, tile) => sum + tile.value, 0);
  return {
    scope: 'source',
    cwd: repo.cwd,
    source,
    totalValue,
    tiles: sourceTiles.length > 0 ? sourceTiles : [{
      label: 'empty source',
      kind: 'meta',
      value: 1,
      detail: 'No CAS entries resolved for this source',
    }],
    notes: [
      'Source view weights tiles by logical manifest size.',
    ],
    summary: {
      bare: repo.bare,
      gitDir: repo.gitDir,
      worktreeItems: 0,
      refNamespaces: 0,
      refCount: 0,
      vaultEntries: source.type === 'vault' ? sourceResult.entries.length : 0,
      sourceEntries: sourceResult.entries.length,
    },
  };
}

/**
 * Build repository-scope physical and logical tiles.
 *
 * @param {{
 *   cas: ContentAddressableStore,
 *   source: DashSource,
 *   repo: { cwd: string, gitDir: string, bare: boolean },
 *   plumbing: { execute: ({ args }: { args: string[] }) => Promise<string> },
 *   sourceResult: { entries: ExplorerEntry[] },
 *   sourceRecords: Array<ExplorerEntry & { manifest: any, size: number }>,
 * }} options
 * @returns {Promise<RepoTreemapReport>}
 */
async function buildRepositoryScopeReport({ cas, source, repo, plumbing, sourceResult, sourceRecords }) {
  const worktreeTiles = repo.bare
    ? []
    : await scanDirectoryTiles(repo.cwd, 'worktree', (name) => name).then((tiles) => tiles.filter((tile) => tile.label !== path.basename(repo.gitDir)));
  const gitTiles = await scanDirectoryTiles(repo.gitDir, 'git', (name) => repo.bare ? name : `.git/${name}`);
  const { tiles: refTiles, totalRefs } = await readRefNamespaceTiles(plumbing);
  const vaultResult = source.type === 'vault' ? sourceResult : await readSourceEntries(cas, { type: 'vault' });
  const vaultRecords = source.type === 'vault' ? sourceRecords : await loadEntryRecords(cas, vaultResult.entries);
  const vaultTile = aggregateLogicalTile('vault', 'vault', vaultRecords);
  const activeSourceTile = source.type !== 'vault'
    ? aggregateLogicalTile('active source', 'cas', sourceRecords)
    : null;
  const tiles = compactTiles([
    ...worktreeTiles,
    ...gitTiles,
    ...refTiles,
    ...(vaultTile ? [vaultTile] : []),
    ...(activeSourceTile ? [activeSourceTile] : []),
  ]);
  const totalValue = tiles.reduce((sum, tile) => sum + tile.value, 0);

  return {
    scope: 'repository',
    cwd: repo.cwd,
    source,
    totalValue,
    tiles: tiles.length > 0 ? tiles : [{
      label: 'empty repo',
      kind: 'meta',
      value: 1,
      detail: 'No worktree, ref, or CAS regions were detected',
    }],
    notes: [
      'Repository view mixes worktree/.git bytes with logical CAS region sizes.',
      repo.bare ? 'Bare repository: worktree regions are omitted.' : `Git dir ${repo.gitDir}`,
    ],
    summary: {
      bare: repo.bare,
      gitDir: repo.gitDir,
      worktreeItems: worktreeTiles.length,
      refNamespaces: refTiles.length,
      refCount: totalRefs,
      vaultEntries: vaultResult.entries.length,
      sourceEntries: sourceResult.entries.length,
    },
  };
}

/**
 * Return true when the provided tree OID resolves to a CAS manifest.
 *
 * @param {ContentAddressableStore} cas
 * @param {string} treeOid
 * @returns {Promise<boolean>}
 */
async function canReadManifest(cas, treeOid) {
  try {
    await cas.readManifest({ treeOid });
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to resolve a commit/tree-ish object into a tree OID.
 *
 * @param {{ resolveTree: (commitOid: string) => Promise<string> }} refPort
 * @param {string} oid
 * @returns {Promise<string | null>}
 */
async function tryResolveTree(refPort, oid) {
  try {
    return await refPort.resolveTree(oid);
  } catch {
    return null;
  }
}

/**
 * Read and parse a JSON blob by object ID.
 *
 * @param {{ readBlob: (oid: string) => Promise<Buffer> }} persistence
 * @param {string} oid
 * @returns {Promise<any | null>}
 */
async function tryReadJsonBlob(persistence, oid) {
  try {
    const blob = await persistence.readBlob(oid);
    return JSON.parse(blob.toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Normalize a JSON entry into explorer rows.
 *
 * @param {unknown} value
 * @param {string} fallbackSlug
 * @returns {ExplorerEntry | null}
 */
function toIndexedEntry(value, fallbackSlug) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = /** @type {Record<string, any>} */ (value);
  if (typeof record.treeOid !== 'string') {
    return null;
  }
  return {
    slug: typeof record.slug === 'string'
      ? record.slug
      : typeof record.key === 'string'
        ? record.key
        : typeof record.id === 'string'
          ? record.id
          : fallbackSlug,
    treeOid: record.treeOid,
  };
}

/**
 * Extract CAS tree references from common JSON index shapes.
 *
 * Supports:
 * - `{ treeOid }`
 * - `{ entries: { key: { treeOid } } }`
 * - `{ entries: [{ treeOid, slug? | key? | id? }] }`
 * - `[{ treeOid, ... }]`
 *
 * @param {unknown} json
 * @param {string} label
 * @returns {ExplorerEntry[]}
 */
function extractJsonEntries(json, label) {
  const entries = [];

  const direct = toIndexedEntry(json, label);
  if (direct) {
    entries.push(direct);
  }

  if (Array.isArray(json)) {
    return json
      .map((item, index) => toIndexedEntry(item, `${label}#${index + 1}`))
      .filter(Boolean)
      .sort((left, right) => left.slug.localeCompare(right.slug));
  }

  if (!json || typeof json !== 'object') {
    return entries;
  }

  const record = /** @type {Record<string, any>} */ (json);
  if (Array.isArray(record.entries)) {
    return record.entries
      .map((item, index) => toIndexedEntry(item, `${label}#${index + 1}`))
      .filter(Boolean)
      .sort((left, right) => left.slug.localeCompare(right.slug));
  }

  if (record.entries && typeof record.entries === 'object' && !Array.isArray(record.entries)) {
    return Object.entries(record.entries)
      .map(([key, value]) => toIndexedEntry(value, key))
      .filter(Boolean)
      .sort((left, right) => left.slug.localeCompare(right.slug));
  }

  return entries;
}

/**
 * Parse a manifest tree hint out of a commit message.
 *
 * @param {{ plumbing?: { execute: ({ args }: { args: string[] }) => Promise<string> } }} persistence
 * @param {string} oid
 * @returns {Promise<string | null>}
 */
async function tryReadManifestHint(persistence, oid) {
  if (!persistence.plumbing || typeof persistence.plumbing.execute !== 'function') {
    return null;
  }
  try {
    const message = await persistence.plumbing.execute({
      args: ['show', '-s', '--format=%B', oid],
    });
    const match = message.match(/^\s*manifest:\s*([0-9a-f]{7,64})\s*$/mi);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Resolve dashboard entries for a non-vault source.
 *
 * @param {ContentAddressableStore} cas
 * @param {{ type: 'ref', ref: string } | { type: 'oid', treeOid: string }} source
 * @returns {Promise<{ entries: ExplorerEntry[], metadata: any }>}
 */
async function resolveNonVaultSource(cas, source) {
  if (source.type === 'oid') {
    return singleEntrySource(`oid:${shortOid(source.treeOid)}`, source.treeOid);
  }

  const [service, vault] = await Promise.all([
    cas.getService(),
    cas.getVaultService(),
  ]);
  const resolvedOid = await vault.ref.resolveRef(source.ref);

  if (await canReadManifest(cas, resolvedOid)) {
    return singleEntrySource(source.ref, resolvedOid);
  }

  const treeOid = await tryResolveTree(vault.ref, resolvedOid);
  if (treeOid && await canReadManifest(cas, treeOid)) {
    return singleEntrySource(`${source.ref}^{tree}`, treeOid);
  }

  const indexed = extractJsonEntries(await tryReadJsonBlob(service.persistence, resolvedOid), source.ref);
  if (indexed.length > 0) {
    return { entries: indexed, metadata: null };
  }

  const hintedTreeOid = await tryReadManifestHint(service.persistence, resolvedOid);
  if (hintedTreeOid) {
    return singleEntrySource(source.ref, hintedTreeOid);
  }

  throw new Error(`Ref ${source.ref} did not resolve to a vault, CAS tree, supported CAS index, or manifest hint`);
}

/**
 * Resolve dashboard entries for the requested source.
 *
 * @param {ContentAddressableStore} cas
 * @param {DashSource} source
 * @returns {Promise<{ entries: ExplorerEntry[], metadata: any }>}
 */
export async function readSourceEntries(cas, source = { type: 'vault' }) {
  if (source.type === 'vault') {
    const [entries, metadata] = await Promise.all([
      cas.listVault(),
      cas.getVaultMetadata(),
    ]);
    return { entries, metadata };
  }
  return resolveNonVaultSource(cas, source);
}

/**
 * Build the semantic repo/source treemap report for the dashboard.
 *
 * @param {ContentAddressableStore} cas
 * @param {DashSource} [source]
 * @param {TreemapScope} [scope]
 * @returns {Promise<RepoTreemapReport>}
 */
export async function buildRepoTreemapReport(cas, source = { type: 'vault' }, scope = 'repository') {
  const service = await cas.getService();
  const repo = await resolveRepoInfo(service.persistence.plumbing);
  const sourceResult = await readSourceEntries(cas, source);
  const sourceRecords = await loadEntryRecords(cas, sourceResult.entries);

  if (scope === 'source') {
    return buildSourceScopeReport({ repo, source, sourceResult, sourceRecords });
  }
  return buildRepositoryScopeReport({
    cas,
    source,
    repo,
    plumbing: service.persistence.plumbing,
    sourceResult,
    sourceRecords,
  });
}

/**
 * Load vault entries and metadata in parallel.
 *
 * @param {ContentAddressableStore} cas
 * @param {DashSource} [source]
 */
export function loadEntriesCmd(cas, source = { type: 'vault' }) {
  return async () => {
    try {
      const { entries, metadata } = await readSourceEntries(cas, source);
      return /** @type {const} */ ({ type: 'loaded-entries', entries, metadata });
    } catch (/** @type {any} */ err) {
      return /** @type {const} */ ({ type: 'load-error', source: 'entries', error: /** @type {Error} */ (err).message });
    }
  };
}

/**
 * Load a single manifest by slug and tree OID.
 *
 * @param {ContentAddressableStore} cas
 * @param {string} slug
 * @param {string} treeOid
 */
export function loadManifestCmd(cas, slug, treeOid) {
  return async () => {
    try {
      const manifest = await cas.readManifest({ treeOid });
      return /** @type {const} */ ({ type: 'loaded-manifest', slug, manifest });
    } catch (/** @type {any} */ err) {
      return /** @type {const} */ ({ type: 'load-error', source: 'manifest', slug, error: /** @type {Error} */ (err).message });
    }
  };
}

/**
 * Load aggregate vault stats for the current vault.
 *
 * @param {ContentAddressableStore} cas
 * @param {ExplorerEntry[]} entries
 */
export function loadStatsCmd(cas, entries) {
  return async () => {
    try {
      const records = await Promise.all(entries.map(async (entry) => ({
        ...entry,
        manifest: await cas.readManifest({ treeOid: entry.treeOid }),
      })));
      return /** @type {const} */ ({ type: 'loaded-stats', stats: buildVaultStats(records) });
    } catch (/** @type {any} */ err) {
      return /** @type {const} */ ({ type: 'load-error', source: 'stats', error: /** @type {Error} */ (err).message });
    }
  };
}

/**
 * Load the doctor report for the current vault.
 *
 * @param {ContentAddressableStore} cas
 * @param {DashSource} [source]
 * @param {ExplorerEntry[]} [entries]
 */
export function loadDoctorCmd(cas, source = { type: 'vault' }, entries = []) {
  return async () => {
    try {
      if (source.type !== 'vault') {
        const target = source.type === 'ref' ? source.ref : source.treeOid;
        const report = `source: ${source.type}\n`
          + `target: ${target}\n`
          + `entries: ${entries.length}\n\n`
          + 'Repo-wide doctor currently targets vault mode. Use this source mode to inspect manifests and source-local stats.';
        return /** @type {const} */ ({ type: 'loaded-doctor', report });
      }
      const report = await inspectVaultHealth(cas);
      return /** @type {const} */ ({ type: 'loaded-doctor', report });
    } catch (/** @type {any} */ err) {
      return /** @type {const} */ ({ type: 'load-error', source: 'doctor', error: /** @type {Error} */ (err).message });
    }
  };
}

/**
 * Load the repository/source treemap report for the dashboard drawer.
 *
 * @param {ContentAddressableStore} cas
 * @param {DashSource} [source]
 * @param {TreemapScope} [scope]
 */
export function loadTreemapCmd(cas, source = { type: 'vault' }, scope = 'repository') {
  return async () => {
    try {
      const report = await buildRepoTreemapReport(cas, source, scope);
      return /** @type {const} */ ({ type: 'loaded-treemap', report });
    } catch (/** @type {any} */ err) {
      return /** @type {const} */ ({ type: 'load-error', source: 'treemap', scopeId: scope, error: /** @type {Error} */ (err).message });
    }
  };
}
