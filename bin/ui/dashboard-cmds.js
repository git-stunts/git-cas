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
/** @typedef {'tracked' | 'ignored'} TreemapWorktreeMode */
/** @typedef {'oid' | 'manifest' | 'tree' | 'index' | 'hint' | 'opaque'} RefResolutionKind */
/** @typedef {'worktree' | 'git' | 'ref' | 'vault' | 'cas' | 'meta'} RepoTreemapKind */
/** @typedef {{ kind: Exclude<RepoTreemapKind, 'meta'>, segments: string[], label: string }} TreemapPathNode */
/** @typedef {{ id: string, label: string, kind: RepoTreemapKind, value: number, detail: string, drillable: boolean, path: TreemapPathNode | null }} RepoTreemapTile */
/** @typedef {{
 *   ref: string,
 *   oid: string,
 *   namespace: string,
 *   browsable: boolean,
 *   resolution: RefResolutionKind,
 *   entryCount: number,
 *   detail: string,
 *   previewSlugs: string[],
 *   source: Extract<DashSource, { type: 'ref' }> | null,
 * }} RefInventoryItem */
/** @typedef {{
 *   namespaces: Array<{ namespace: string, count: number, browsable: number }>,
 *   refs: RefInventoryItem[],
 * }} RefInventory */
/** @typedef {{
 *   scope: TreemapScope,
 *   worktreeMode: TreemapWorktreeMode,
 *   cwd: string,
 *   source: DashSource,
 *   drillPath: TreemapPathNode[],
 *   breadcrumb: string[],
 *   totalValue: number,
 *   tiles: RepoTreemapTile[],
 *   notes: string[],
 *   summary: {
 *     bare: boolean,
 *     gitDir: string,
 *     worktreeItems: number,
 *     worktreePaths: number,
 *     refNamespaces: number,
 *     refCount: number,
 *     vaultEntries: number,
 *     sourceEntries: number,
 *   }
 * }} RepoTreemapReport
 */
/** @typedef {{ segments: string[], value: number, detail: string }} HierarchyRecord */

/**
 * Namespace bucket label for a git ref.
 *
 * @param {string} ref
 * @returns {string}
 */
function refNamespace(ref) {
  const parts = ref.split('/');
  if (parts[0] === 'refs' && parts[1]) {
    return `refs/${parts[1]}`;
  }
  return parts[0] || ref;
}

/**
 * Build the segment layout used by the treemap for a git ref.
 *
 * Root scope groups refs by namespace such as `refs/heads` or `refs/warp`
 * rather than starting with the raw `refs` segment.
 *
 * @param {string} ref
 * @returns {string[]}
 */
function refSegments(ref) {
  const parts = ref.split('/');
  if (parts[0] === 'refs' && parts[1]) {
    return [`refs/${parts[1]}`, ...parts.slice(2)];
  }
  return parts.filter(Boolean);
}

/**
 * Return the display label for one drill path.
 *
 * @param {TreemapPathNode[]} drillPath
 * @returns {string}
 */
function drillLabel(drillPath) {
  return drillPath.map((node) => node.label).join(' / ') || 'root';
}

/**
 * Create a stable tile id for one hierarchical segment path.
 *
 * @param {Exclude<RepoTreemapKind, 'meta'>} kind
 * @param {string[]} segments
 * @returns {string}
 */
function tileId(kind, segments) {
  return `${kind}:${segments.join('\u001f')}`;
}

/**
 * Create one treemap path node from a kind and segment list.
 *
 * @param {Exclude<RepoTreemapKind, 'meta'>} kind
 * @param {string[]} segments
 * @returns {TreemapPathNode}
 */
function pathNode(kind, segments) {
  return {
    kind,
    segments,
    label: segments[segments.length - 1] ?? '',
  };
}

/**
 * Return true when one segment list is nested under another.
 *
 * @param {string[]} left
 * @param {string[]} right
 * @returns {boolean}
 */
function segmentsStartWith(left, right) {
  if (right.length > left.length) {
    return false;
  }
  return right.every((segment, index) => left[index] === segment);
}

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
 * Describe how a ref resolved into CAS entries.
 *
 * @param {RefResolutionKind} resolution
 * @param {{ entries: ExplorerEntry[], resolvedOid?: string, targetTreeOid?: string | null }} result
 * @returns {string}
 */
function describeResolution(resolution, result) {
  const entryLabel = `${result.entries.length} CAS entr${result.entries.length === 1 ? 'y' : 'ies'}`;
  const target = shortOid(result.targetTreeOid ?? result.resolvedOid ?? '');
  switch (resolution) {
    case 'manifest':
      return `direct manifest tree ${target}`;
    case 'tree':
      return `commit/tree target ${target}`;
    case 'index':
      return `${entryLabel} from index blob`;
    case 'hint':
      return `manifest hint ${target}`;
    case 'oid':
      return `direct CAS tree ${target}`;
    default:
      return entryLabel;
  }
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
 * Parse null-delimited Git output into raw repo-relative paths.
 *
 * @param {string} output
 * @returns {string[]}
 */
function parseNullPaths(output) {
  return output.split('\0').filter(Boolean);
}

/**
 * Normalize a repo-relative path and return its top-level label.
 *
 * @param {string} repoPath
 * @returns {string}
 */
/**
 * Recursively collect file records from the filesystem without following
 * symlinks. Directories contribute their leaf files so the treemap can drill
 * deeper instead of stopping at one opaque directory tile.
 *
 * @param {string} targetPath
 * @param {string[]} segments
 * @returns {Promise<Array<{ segments: string[], value: number }>>}
 */
async function collectFilesystemRecords(targetPath, segments) {
  let stat;
  try {
    stat = await lstat(targetPath);
  } catch {
    return [];
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return [{ segments, value: stat.size }];
  }
  let entries;
  try {
    entries = await readdir(targetPath, { withFileTypes: true });
  } catch {
    return [];
  }
  return (await Promise.all(entries.map((entry) =>
    collectFilesystemRecords(path.join(targetPath, entry.name), [...segments, entry.name])))).flat();
}

/**
 * Collect Git-reported worktree records for tracked or ignored mode.
 *
 * Tracked mode stays faithful to `git ls-files`. Ignored mode recursively
 * expands ignored directories so the treemap can drill deeper than the single
 * top-level bucket returned by Git.
 *
 * @param {{
 *   plumbing: { execute: ({ args }: { args: string[] }) => Promise<string> },
 *   repo: { cwd: string, bare: boolean },
 *   worktreeMode: TreemapWorktreeMode,
 * }} options
 * @returns {Promise<{ records: HierarchyRecord[], pathCount: number }>}
 */
async function collectWorktreeRecords({ plumbing, repo, worktreeMode }) {
  if (repo.bare) {
    return { records: [], pathCount: 0 };
  }

  const args = worktreeMode === 'ignored'
    ? ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--no-empty-directory', '-z']
    : ['ls-files', '-z'];

  let output = '';
  try {
    output = await plumbing.execute({ args });
  } catch {
    return { records: [], pathCount: 0 };
  }

  const repoPaths = parseNullPaths(output);
  const rawRecords = (await Promise.all(repoPaths.map(async (repoPath) => {
    const normalizedPath = repoPath.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalizedPath || normalizedPath === '.git' || normalizedPath.startsWith('.git/')) {
      return [];
    }

    const fullPath = path.join(repo.cwd, normalizedPath);
    const stat = await lstat(fullPath).catch(() => null);
    if (!stat) {
      return [];
    }

    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      return collectFilesystemRecords(fullPath, normalizedPath.split('/'));
    }

    return [{ segments: normalizedPath.split('/'), value: stat.size }];
  }))).flat();

  return {
    records: rawRecords.map((record) => ({
      ...record,
      detail: `1 ${worktreeMode} path · ${formatBytes(record.value)} on disk`,
    })),
    pathCount: repoPaths.length,
  };
}

/**
 * Collect git-dir records so repository treemap drill-down can move from
 * `.git/objects` to packfiles and loose-object fanout directories.
 *
 * @param {{ gitDir: string, bare: boolean }} repo
 * @returns {Promise<HierarchyRecord[]>}
 */
async function collectGitRecords(repo) {
  let entries;
  try {
    entries = await readdir(repo.gitDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const rawRecords = (await Promise.all(entries.map(async (entry) => {
    if (entry.name === 'refs') {
      return [];
    }
    const rootLabel = repo.bare ? entry.name : `.git/${entry.name}`;
    return collectFilesystemRecords(path.join(repo.gitDir, entry.name), [rootLabel]);
  }))).flat();

  return rawRecords.map((record) => ({
    ...record,
    detail: `${formatBytes(record.value)} on disk`,
  }));
}

/**
 * Collect one hierarchy record per ref for repository treemap drill-down.
 *
 * @param {RefInventory} inventory
 * @returns {HierarchyRecord[]}
 */
function collectRefRecords(inventory) {
  return inventory.refs.map((ref) => ({
    segments: refSegments(ref.ref),
    value: Math.max(1, 4096),
    detail: `${ref.browsable ? 'browsable' : 'opaque'} · ${ref.detail} · ${shortOid(ref.oid)}`,
  }));
}

/**
 * Collect logical source records keyed by slug path.
 *
 * @param {Array<ExplorerEntry & { manifest: any, size: number }>} records
 * @returns {HierarchyRecord[]}
 */
function collectLogicalRecords(records) {
  return records.map((record) => {
    const data = manifestData(record.manifest);
    const format = data.compression?.algorithm ?? 'raw';
    const crypto = data.encryption ? 'enc' : 'plain';
    return {
      segments: record.slug.split('/').filter(Boolean),
      value: Math.max(1, record.size),
      detail: `${formatBytes(record.size)} logical · ${data.chunks?.length ?? 0} chunks · ${crypto}/${format}`,
    };
  });
}

/**
 * Build one visible hierarchy level from leaf records.
 *
 * @param {HierarchyRecord[]} records
 * @param {{
 *   kind: Exclude<RepoTreemapKind, 'meta'>,
 *   prefixSegments?: string[],
 *   aggregateDetail: (bucket: { segments: string[], records: HierarchyRecord[], value: number }) => string,
 * }} options
 * @returns {RepoTreemapTile[]}
 */
function buildHierarchyTiles(records, options) {
  const prefixSegments = options.prefixSegments ?? [];
  const buckets = new Map();

  for (const record of records) {
    if (!segmentsStartWith(record.segments, prefixSegments)) {
      continue;
    }
    if (record.segments.length <= prefixSegments.length) {
      continue;
    }
    const childSegments = [...prefixSegments, record.segments[prefixSegments.length]];
    const key = tileId(options.kind, childSegments);
    const bucket = buckets.get(key) ?? { segments: childSegments, records: [], value: 0 };
    bucket.records.push(record);
    bucket.value += record.value;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.values())
    .map((bucket) => {
      const leaf = bucket.records.length === 1 && bucket.records[0].segments.length === bucket.segments.length
        ? bucket.records[0]
        : null;
      return {
        id: tileId(options.kind, bucket.segments),
        label: bucket.segments[bucket.segments.length - 1] ?? '',
        kind: options.kind,
        value: Math.max(1, bucket.value),
        detail: leaf ? leaf.detail : options.aggregateDetail(bucket),
        drillable: !leaf,
        path: pathNode(options.kind, bucket.segments),
      };
    })
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
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
 * Collapse low-value tiles into a single "other" bucket so the treemap stays legible.
 *
 * @param {RepoTreemapTile[]} tiles
 * @param {number} limit
 * @returns {RepoTreemapTile[]}
 */
function compactTiles(tiles, limit = 14) {
  const sorted = [...tiles].sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
  if (sorted.length <= limit) {
    return sorted;
  }
  const kept = sorted.slice(0, limit - 1);
  const remainder = sorted.slice(limit - 1);
  const otherValue = remainder.reduce((sum, tile) => sum + tile.value, 0);
  kept.push({
    id: 'meta:other',
    label: 'other',
    kind: 'meta',
    value: Math.max(1, otherValue),
    detail: `${remainder.length} smaller regions`,
    drillable: false,
    path: null,
  });
  return kept;
}

/**
 * Aggregate detail line for worktree hierarchy buckets.
 *
 * @param {TreemapWorktreeMode} worktreeMode
 * @param {{ records: HierarchyRecord[], value: number }} bucket
 * @returns {string}
 */
function worktreeAggregateDetail(worktreeMode, bucket) {
  return `${bucket.records.length} ${worktreeMode} path${bucket.records.length === 1 ? '' : 's'} · ${formatBytes(bucket.value)} on disk`;
}

/**
 * Aggregate detail line for git-dir hierarchy buckets.
 *
 * @param {{ records: HierarchyRecord[], value: number }} bucket
 * @returns {string}
 */
function gitAggregateDetail(bucket) {
  return `${bucket.records.length} git item${bucket.records.length === 1 ? '' : 's'} · ${formatBytes(bucket.value)} on disk`;
}

/**
 * Aggregate detail line for ref hierarchy buckets.
 *
 * @param {{ records: HierarchyRecord[] }} bucket
 * @returns {string}
 */
function refAggregateDetail(bucket) {
  return `${bucket.records.length} ref${bucket.records.length === 1 ? '' : 's'}`;
}

/**
 * Aggregate detail line for logical CAS hierarchy buckets.
 *
 * @param {{ records: HierarchyRecord[], value: number }} bucket
 * @returns {string}
 */
function logicalAggregateDetail(bucket) {
  return `${bucket.records.length} entr${bucket.records.length === 1 ? 'y' : 'ies'} · ${formatBytes(bucket.value)} logical`;
}

/**
 * Build repository-scope notes.
 *
 * @param {{ gitDir: string, bare: boolean }} repo
 * @param {TreemapWorktreeMode} worktreeMode
 * @param {TreemapPathNode[]} drillPath
 * @returns {string[]}
 */
function buildRepositoryNotes(repo, worktreeMode, drillPath) {
  return [
    drillPath.length > 0
      ? `Drilled into ${drillLabel(drillPath)}. Press - to go up a level.`
      : 'Repository view mixes Git-reported worktree paths, .git on-disk bytes, ref namespaces, and logical CAS region sizes.',
    'Press r to browse refs and switch the dashboard source to a CAS-backed ref.',
    repo.bare
      ? 'Bare repository: worktree regions are omitted.'
      : `Worktree mode ${worktreeMode} via ${worktreeMode === 'tracked' ? 'git ls-files' : 'git ls-files --others --ignored --exclude-standard'}.`,
    `Git dir ${repo.gitDir}`,
  ];
}

/**
 * Tile kind used for logical source treemap nodes.
 *
 * @param {DashSource} source
 * @returns {'vault' | 'cas'}
 */
function logicalSourceKind(source) {
  return source.type === 'vault' ? 'vault' : 'cas';
}

/**
 * Human-readable source target used in notes and empty states.
 *
 * @param {DashSource} source
 * @returns {string}
 */
function sourceTarget(source) {
  if (source.type === 'vault') {
    return 'the vault';
  }
  return source.type === 'ref' ? source.ref : source.treeOid;
}

/**
 * Empty source fallback tile.
 *
 * @returns {RepoTreemapTile}
 */
function emptySourceTile() {
  return {
    id: 'meta:empty-source',
    label: 'empty source',
    kind: 'meta',
    value: 1,
    detail: 'No CAS entries resolved for this source',
    drillable: false,
    path: null,
  };
}

/**
 * Explanatory note lines for source scope.
 *
 * @param {{ source: DashSource, sourceResult: { entries: ExplorerEntry[] }, drillPath: TreemapPathNode[] }} options
 * @returns {string[]}
 */
function buildSourceNotes({ source, sourceResult, drillPath }) {
  const firstLine = sourceResult.entries.length === 0
    ? `No CAS entries resolved for ${sourceTarget(source)}. Press r to browse refs or T to return to repository scope.`
    : drillPath.length > 0
      ? `Drilled into ${drillLabel(drillPath)}. Press - to go up a level.`
      : `Loaded ${sourceResult.entries.length} source entr${sourceResult.entries.length === 1 ? 'y' : 'ies'} for ${sourceTarget(source)}.`;

  return [
    firstLine,
    'Source view weights tiles by logical manifest size.',
  ];
}

/**
 * Summary block for source scope reports.
 *
 * @param {{
 *   repo: { bare: boolean, gitDir: string },
 *   source: DashSource,
 *   sourceResult: { entries: ExplorerEntry[] },
 * }} options
 * @returns {RepoTreemapReport['summary']}
 */
function buildSourceSummary({ repo, source, sourceResult }) {
  return {
    bare: repo.bare,
    gitDir: repo.gitDir,
    worktreeItems: 0,
    worktreePaths: 0,
    refNamespaces: 0,
    refCount: 0,
    vaultEntries: source.type === 'vault' ? sourceResult.entries.length : 0,
    sourceEntries: sourceResult.entries.length,
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
 *   drillPath: TreemapPathNode[],
 * }} options
 * @returns {RepoTreemapReport}
 */
function buildSourceScopeReport({ repo, source, sourceResult, sourceRecords, drillPath }) {
  const logicalKind = logicalSourceKind(source);
  const prefixSegments = drillPath[drillPath.length - 1]?.segments ?? [];
  const sourceTiles = compactTiles(buildHierarchyTiles(collectLogicalRecords(sourceRecords), {
    kind: logicalKind,
    prefixSegments,
    aggregateDetail: logicalAggregateDetail,
  }), drillPath.length > 0 ? 24 : 18);
  const totalValue = sourceTiles.reduce((sum, tile) => sum + tile.value, 0);
  return {
    scope: 'source',
    worktreeMode: 'tracked',
    cwd: repo.cwd,
    source,
    drillPath,
    breadcrumb: ['source', ...drillPath.map((node) => node.label)],
    totalValue,
    tiles: sourceTiles.length > 0 ? sourceTiles : [emptySourceTile()],
    notes: buildSourceNotes({ source, sourceResult, drillPath }),
    summary: buildSourceSummary({ repo, source, sourceResult }),
  };
}

/**
 * Worktree treemap options for one hierarchy level.
 *
 * @param {TreemapWorktreeMode} worktreeMode
 * @param {string[]} [prefixSegments]
 * @returns {{
 *   kind: 'worktree',
 *   prefixSegments?: string[],
 *   aggregateDetail: (bucket: { records: HierarchyRecord[], value: number }) => string,
 * }}
 */
function worktreeTileOptions(worktreeMode, prefixSegments = []) {
  return {
    kind: 'worktree',
    prefixSegments,
    aggregateDetail: (bucket) => worktreeAggregateDetail(worktreeMode, bucket),
  };
}

/**
 * Repository root tiles across worktree, git, refs, vault, and source data.
 *
 * @param {{
 *   worktreeRecords: HierarchyRecord[],
 *   gitRecords: HierarchyRecord[],
 *   refRecords: HierarchyRecord[],
 *   vaultLogicalRecords: HierarchyRecord[],
 *   sourceLogicalRecords: HierarchyRecord[],
 *   worktreeMode: TreemapWorktreeMode,
 * }} options
 * @returns {RepoTreemapTile[]}
 */
function buildRepositoryRootTiles(options) {
  return compactTiles([
    ...buildHierarchyTiles(options.worktreeRecords, worktreeTileOptions(options.worktreeMode)),
    ...buildHierarchyTiles(options.gitRecords, {
      kind: 'git',
      aggregateDetail: gitAggregateDetail,
    }),
    ...buildHierarchyTiles(options.refRecords, {
      kind: 'ref',
      aggregateDetail: refAggregateDetail,
    }),
    ...buildHierarchyTiles(options.vaultLogicalRecords, {
      kind: 'vault',
      aggregateDetail: logicalAggregateDetail,
    }),
    ...buildHierarchyTiles(options.sourceLogicalRecords, {
      kind: 'cas',
      aggregateDetail: logicalAggregateDetail,
    }),
  ], 18);
}

/**
 * Drill one repository category deeper based on the selected treemap node.
 *
 * @param {{
 *   currentNode: TreemapPathNode,
 *   worktreeRecords: HierarchyRecord[],
 *   gitRecords: HierarchyRecord[],
 *   refRecords: HierarchyRecord[],
 *   vaultLogicalRecords: HierarchyRecord[],
 *   sourceLogicalRecords: HierarchyRecord[],
 *   worktreeMode: TreemapWorktreeMode,
 * }} options
 * @returns {RepoTreemapTile[]}
 */
function buildRepositoryDrillTiles(options) {
  const tileBuilders = {
    worktree: () => buildHierarchyTiles(options.worktreeRecords, worktreeTileOptions(options.worktreeMode, options.currentNode.segments)),
    git: () => buildHierarchyTiles(options.gitRecords, {
      kind: 'git',
      prefixSegments: options.currentNode.segments,
      aggregateDetail: gitAggregateDetail,
    }),
    ref: () => buildHierarchyTiles(options.refRecords, {
      kind: 'ref',
      prefixSegments: options.currentNode.segments,
      aggregateDetail: refAggregateDetail,
    }),
    vault: () => buildHierarchyTiles(options.vaultLogicalRecords, {
      kind: 'vault',
      prefixSegments: options.currentNode.segments,
      aggregateDetail: logicalAggregateDetail,
    }),
    cas: () => buildHierarchyTiles(options.sourceLogicalRecords, {
      kind: 'cas',
      prefixSegments: options.currentNode.segments,
      aggregateDetail: logicalAggregateDetail,
    }),
  };

  return compactTiles(tileBuilders[options.currentNode.kind](), 24);
}

/**
 * Summary block for repository scope reports.
 *
 * @param {{
 *   repo: { bare: boolean, gitDir: string },
 *   worktreeRecords: HierarchyRecord[],
 *   worktreePaths: number,
 *   refInventory: RefInventory,
 *   vaultEntries: number,
 *   sourceEntries: number,
 *   worktreeMode: TreemapWorktreeMode,
 * }} options
 * @returns {RepoTreemapReport['summary']}
 */
function buildRepositorySummary(options) {
  return {
    bare: options.repo.bare,
    gitDir: options.repo.gitDir,
    worktreeItems: buildHierarchyTiles(options.worktreeRecords, worktreeTileOptions(options.worktreeMode)).length,
    worktreePaths: options.worktreePaths,
    refNamespaces: options.refInventory.namespaces.length,
    refCount: options.refInventory.refs.length,
    vaultEntries: options.vaultEntries,
    sourceEntries: options.sourceEntries,
  };
}

/**
 * Data inputs needed to build repository treemap tiles.
 *
 * @param {{
 *   cas: ContentAddressableStore,
 *   source: DashSource,
 *   repo: { cwd: string, gitDir: string, bare: boolean },
 *   plumbing: { execute: ({ args }: { args: string[] }) => Promise<string> },
 *   sourceResult: { entries: ExplorerEntry[] },
 *   sourceRecords: Array<ExplorerEntry & { manifest: any, size: number }>,
 *   worktreeMode: TreemapWorktreeMode,
 * }} options
 * @returns {Promise<{
 *   worktreeRecords: HierarchyRecord[],
 *   worktreePaths: number,
 *   gitRecords: HierarchyRecord[],
 *   refInventory: RefInventory,
 *   refRecords: HierarchyRecord[],
 *   vaultResult: { entries: ExplorerEntry[] },
 *   vaultLogicalRecords: HierarchyRecord[],
 *   sourceLogicalRecords: HierarchyRecord[],
 * }>}
 */
async function loadRepositoryScopeData({ cas, source, repo, plumbing, sourceResult, sourceRecords, worktreeMode }) {
  const [{ records: worktreeRecords, pathCount: worktreePaths }, gitRecords, refInventory] = await Promise.all([
    collectWorktreeRecords({ plumbing, repo, worktreeMode }),
    collectGitRecords(repo),
    readRefInventory(cas),
  ]);
  const refRecords = collectRefRecords(refInventory);
  const vaultResult = source.type === 'vault' ? sourceResult : await readSourceEntries(cas, { type: 'vault' });
  const vaultRecords = source.type === 'vault' ? sourceRecords : await loadEntryRecords(cas, vaultResult.entries);

  return {
    worktreeRecords,
    worktreePaths,
    gitRecords,
    refInventory,
    refRecords,
    vaultResult,
    vaultLogicalRecords: collectLogicalRecords(vaultRecords),
    sourceLogicalRecords: source.type === 'vault' ? [] : collectLogicalRecords(sourceRecords),
  };
}

/**
 * Empty repository fallback tile.
 *
 * @returns {RepoTreemapTile[]}
 */
function emptyRepositoryTiles() {
  return [{
    id: 'meta:empty-repo',
    label: 'empty repo',
    kind: 'meta',
    value: 1,
    detail: 'No worktree, ref, or CAS regions were detected',
    drillable: false,
    path: null,
  }];
}

/**
 * Final repository-scope report object.
 *
 * @param {{
 *   repo: { cwd: string, gitDir: string, bare: boolean },
 *   source: DashSource,
 *   worktreeMode: TreemapWorktreeMode,
 *   drillPath: TreemapPathNode[],
 *   tiles: RepoTreemapTile[],
 *   worktreeRecords: HierarchyRecord[],
 *   worktreePaths: number,
 *   refInventory: RefInventory,
 *   vaultEntries: number,
 *   sourceEntries: number,
 * }} options
 * @returns {RepoTreemapReport}
 */
function repositoryScopeReport(options) {
  return {
    scope: 'repository',
    worktreeMode: options.worktreeMode,
    cwd: options.repo.cwd,
    source: options.source,
    drillPath: options.drillPath,
    breadcrumb: ['repository', ...options.drillPath.map((node) => node.label)],
    totalValue: options.tiles.reduce((sum, tile) => sum + tile.value, 0),
    tiles: options.tiles.length > 0 ? options.tiles : emptyRepositoryTiles(),
    notes: buildRepositoryNotes(options.repo, options.worktreeMode, options.drillPath),
    summary: buildRepositorySummary({
      repo: options.repo,
      worktreeRecords: options.worktreeRecords,
      worktreePaths: options.worktreePaths,
      refInventory: options.refInventory,
      vaultEntries: options.vaultEntries,
      sourceEntries: options.sourceEntries,
      worktreeMode: options.worktreeMode,
    }),
  };
}

/**
 * Visible tiles for the current repository drill level.
 *
 * @param {{
 *   drillPath: TreemapPathNode[],
 *   worktreeRecords: HierarchyRecord[],
 *   gitRecords: HierarchyRecord[],
 *   refRecords: HierarchyRecord[],
 *   vaultLogicalRecords: HierarchyRecord[],
 *   sourceLogicalRecords: HierarchyRecord[],
 *   worktreeMode: TreemapWorktreeMode,
 * }} options
 * @returns {RepoTreemapTile[]}
 */
function repositoryTilesForDrillPath(options) {
  const currentNode = options.drillPath[options.drillPath.length - 1] ?? null;
  return currentNode
    ? buildRepositoryDrillTiles({
      currentNode,
      worktreeRecords: options.worktreeRecords,
      gitRecords: options.gitRecords,
      refRecords: options.refRecords,
      vaultLogicalRecords: options.vaultLogicalRecords,
      sourceLogicalRecords: options.sourceLogicalRecords,
      worktreeMode: options.worktreeMode,
    })
    : buildRepositoryRootTiles({
      worktreeRecords: options.worktreeRecords,
      gitRecords: options.gitRecords,
      refRecords: options.refRecords,
      vaultLogicalRecords: options.vaultLogicalRecords,
      sourceLogicalRecords: options.sourceLogicalRecords,
      worktreeMode: options.worktreeMode,
    });
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
  *   worktreeMode: TreemapWorktreeMode,
 *   drillPath: TreemapPathNode[],
 * }} options
 * @returns {Promise<RepoTreemapReport>}
 */
async function buildRepositoryScopeReport({ cas, source, repo, plumbing, sourceResult, sourceRecords, worktreeMode, drillPath }) {
  const {
    worktreeRecords,
    worktreePaths,
    gitRecords,
    refInventory,
    refRecords,
    vaultResult,
    vaultLogicalRecords,
    sourceLogicalRecords,
  } = await loadRepositoryScopeData({
    cas,
    source,
    repo,
    plumbing,
    sourceResult,
    sourceRecords,
    worktreeMode,
  });
  const tiles = repositoryTilesForDrillPath({
    drillPath,
    worktreeRecords,
    gitRecords,
    refRecords,
    vaultLogicalRecords,
    sourceLogicalRecords,
    worktreeMode,
  });
  return repositoryScopeReport({
    repo,
    source,
    worktreeMode,
    drillPath,
    tiles,
    worktreeRecords,
    worktreePaths,
    refInventory,
    vaultEntries: vaultResult.entries.length,
    sourceEntries: sourceResult.entries.length,
  });
}

/**
 * Convert one `show-ref` line into a browsable or opaque ref record.
 *
 * @param {ContentAddressableStore} cas
 * @param {{ service: { persistence: any }, vault: { ref: any } }} ports
 * @param {string} line
 * @returns {Promise<RefInventoryItem>}
 */
async function classifyRefLine(cas, ports, line) {
  const [oid = '', ref = ''] = line.split(' ');
  try {
    const result = await resolveSourceDetailed(cas, { type: 'ref', ref }, ports);
    return {
      ref,
      oid,
      namespace: refNamespace(ref),
      browsable: true,
      resolution: result.resolution,
      entryCount: result.entries.length,
      detail: describeResolution(result.resolution, result),
      previewSlugs: result.entries.slice(0, 3).map((entry) => entry.slug),
      source: { type: 'ref', ref },
    };
  } catch (error) {
    return {
      ref,
      oid,
      namespace: refNamespace(ref),
      browsable: false,
      resolution: 'opaque',
      entryCount: 0,
      detail: error instanceof Error ? error.message : String(error),
      previewSlugs: [],
      source: null,
    };
  }
}

/**
 * Summarize per-namespace ref counts.
 *
 * @param {RefInventoryItem[]} refs
 * @returns {Array<{ namespace: string, count: number, browsable: number }>}
 */
function summarizeRefNamespaces(refs) {
  const namespaceMap = new Map();
  for (const ref of refs) {
    const bucket = namespaceMap.get(ref.namespace) ?? { namespace: ref.namespace, count: 0, browsable: 0 };
    bucket.count += 1;
    bucket.browsable += ref.browsable ? 1 : 0;
    namespaceMap.set(ref.namespace, bucket);
  }
  return Array.from(namespaceMap.values()).sort((left, right) => right.count - left.count || left.namespace.localeCompare(right.namespace));
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
 * Resolve a direct OID source.
 *
 * @param {Extract<DashSource, { type: 'oid' }>} source
 * @returns {{ entries: ExplorerEntry[], metadata: any, resolution: RefResolutionKind, targetTreeOid: string }}
 */
function resolveOidSourceDetailed(source) {
  return {
    ...singleEntrySource(`oid:${shortOid(source.treeOid)}`, source.treeOid),
    resolution: 'oid',
    targetTreeOid: source.treeOid,
  };
}

/**
 * Resolve a ref source into CAS entries.
 *
 * @param {ContentAddressableStore} cas
 * @param {Extract<DashSource, { type: 'ref' }>} source
 * @param {{ service: { persistence: any }, vault: { ref: any } }} ports
 * @returns {Promise<{ entries: ExplorerEntry[], metadata: any, resolution: RefResolutionKind, resolvedOid: string, targetTreeOid?: string | null }>}
 */
async function resolveRefSourceDetailed(cas, source, ports) {
  const { service, vault } = ports;
  const resolvedOid = await vault.ref.resolveRef(source.ref);

  if (await canReadManifest(cas, resolvedOid)) {
    return {
      ...singleEntrySource(source.ref, resolvedOid),
      resolution: 'manifest',
      resolvedOid,
      targetTreeOid: resolvedOid,
    };
  }

  const treeOid = await tryResolveTree(vault.ref, resolvedOid);
  if (treeOid && await canReadManifest(cas, treeOid)) {
    return {
      ...singleEntrySource(`${source.ref}^{tree}`, treeOid),
      resolution: 'tree',
      resolvedOid,
      targetTreeOid: treeOid,
    };
  }

  const indexed = extractJsonEntries(await tryReadJsonBlob(service.persistence, resolvedOid), source.ref);
  if (indexed.length > 0) {
    return {
      entries: indexed,
      metadata: null,
      resolution: 'index',
      resolvedOid,
      targetTreeOid: null,
    };
  }

  const hintedTreeOid = await tryReadManifestHint(service.persistence, resolvedOid);
  if (hintedTreeOid) {
    return {
      ...singleEntrySource(source.ref, hintedTreeOid),
      resolution: 'hint',
      resolvedOid,
      targetTreeOid: hintedTreeOid,
    };
  }

  throw new Error(`Ref ${source.ref} did not resolve to a vault, CAS tree, supported CAS index, or manifest hint`);
}

/**
 * Resolve dashboard entries for a source and include metadata about how the
 * source was derived.
 *
 * @param {ContentAddressableStore} cas
 * @param {DashSource} source
 * @param {{ service?: any, vault?: any }} [ports]
 * @returns {Promise<{ entries: ExplorerEntry[], metadata: any, resolution: RefResolutionKind, resolvedOid?: string, targetTreeOid?: string | null }>}
 */
async function resolveSourceDetailed(cas, source, ports = {}) {
  if (source.type === 'oid') {
    return resolveOidSourceDetailed(source);
  }

  const service = ports.service ?? await cas.getService();
  const vault = ports.vault ?? await cas.getVaultService();
  return resolveRefSourceDetailed(cas, source, { service, vault });
}

/**
 * Resolve dashboard entries for a non-vault source.
 *
 * @param {ContentAddressableStore} cas
 * @param {{ type: 'ref', ref: string } | { type: 'oid', treeOid: string }} source
 * @returns {Promise<{ entries: ExplorerEntry[], metadata: any }>}
 */
async function resolveNonVaultSource(cas, source) {
  const result = await resolveSourceDetailed(cas, source);
  return { entries: result.entries, metadata: result.metadata };
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
 * Read and classify refs so the dashboard can browse namespaces and switch the
 * active source to CAS-backed refs.
 *
 * @param {ContentAddressableStore} cas
 * @returns {Promise<RefInventory>}
 */
export async function readRefInventory(cas) {
  const [service, vault] = await Promise.all([
    cas.getService(),
    cas.getVaultService(),
  ]);

  let output = '';
  try {
    output = await service.persistence.plumbing.execute({ args: ['show-ref'] });
  } catch {
    return { namespaces: [], refs: [] };
  }

  const refs = await Promise.all(output
    .split('\n')
    .map((row) => row.trim())
    .filter(Boolean)
    .map((line) => classifyRefLine(cas, { service, vault }, line)));

  return {
    namespaces: summarizeRefNamespaces(refs),
    refs: refs.sort((left, right) =>
      Number(right.browsable) - Number(left.browsable)
      || left.namespace.localeCompare(right.namespace)
      || left.ref.localeCompare(right.ref)),
  };
}

/**
 * Build the semantic repo/source treemap report for the dashboard.
 *
 * @param {ContentAddressableStore} cas
 * @param {{
 *   source?: DashSource,
 *   scope?: TreemapScope,
 *   worktreeMode?: TreemapWorktreeMode,
 *   drillPath?: TreemapPathNode[],
 * }} [options]
 * @returns {Promise<RepoTreemapReport>}
 */
export async function buildRepoTreemapReport(cas, options = {}) {
  const {
    source = { type: 'vault' },
    scope = 'repository',
    worktreeMode = 'tracked',
    drillPath = [],
  } = options;
  const service = await cas.getService();
  const repo = await resolveRepoInfo(service.persistence.plumbing);
  const sourceResult = await readSourceEntries(cas, source);
  const sourceRecords = await loadEntryRecords(cas, sourceResult.entries);

  if (scope === 'source') {
    return buildSourceScopeReport({ repo, source, sourceResult, sourceRecords, drillPath });
  }
  return buildRepositoryScopeReport({
    cas,
    source,
    repo,
    plumbing: service.persistence.plumbing,
    sourceResult,
    sourceRecords,
    worktreeMode,
    drillPath,
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
      return /** @type {const} */ ({ type: 'loaded-entries', entries, metadata, source });
    } catch (/** @type {any} */ err) {
      return /** @type {const} */ ({ type: 'load-error', source: 'entries', forSource: source, error: /** @type {Error} */ (err).message });
    }
  };
}

/**
 * Load a single manifest by slug and tree OID.
 *
 * @param {ContentAddressableStore} cas
 * @param {{ slug: string, treeOid: string, source: DashSource }} request
 */
export function loadManifestCmd(cas, request) {
  return async () => {
    try {
      const manifest = await cas.readManifest({ treeOid: request.treeOid });
      return /** @type {const} */ ({ type: 'loaded-manifest', slug: request.slug, manifest, source: request.source });
    } catch (/** @type {any} */ err) {
      return /** @type {const} */ ({ type: 'load-error', source: 'manifest', slug: request.slug, forSource: request.source, error: /** @type {Error} */ (err).message });
    }
  };
}

/**
 * Load the current repository ref inventory for the dashboard refs browser.
 *
 * @param {ContentAddressableStore} cas
 */
export function loadRefsCmd(cas) {
  return async () => {
    try {
      const refs = await readRefInventory(cas);
      return /** @type {const} */ ({ type: 'loaded-refs', refs });
    } catch (/** @type {any} */ err) {
      return /** @type {const} */ ({ type: 'load-error', source: 'refs', error: /** @type {Error} */ (err).message });
    }
  };
}

/**
 * Load aggregate vault stats for the current vault.
 *
 * @param {ContentAddressableStore} cas
 * @param {ExplorerEntry[]} entries
 * @param {DashSource} source
 */
export function loadStatsCmd(cas, entries, source) {
  return async () => {
    try {
      const records = await Promise.all(entries.map(async (entry) => ({
        ...entry,
        manifest: await cas.readManifest({ treeOid: entry.treeOid }),
      })));
      return /** @type {const} */ ({ type: 'loaded-stats', stats: buildVaultStats(records), source });
    } catch (/** @type {any} */ err) {
      return /** @type {const} */ ({ type: 'load-error', source: 'stats', forSource: source, error: /** @type {Error} */ (err).message });
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
        return /** @type {const} */ ({ type: 'loaded-doctor', report, source });
      }
      const report = await inspectVaultHealth(cas);
      return /** @type {const} */ ({ type: 'loaded-doctor', report, source });
    } catch (/** @type {any} */ err) {
      return /** @type {const} */ ({ type: 'load-error', source: 'doctor', forSource: source, error: /** @type {Error} */ (err).message });
    }
  };
}

/**
 * Load the repository/source treemap report for the dashboard drawer.
 *
 * @param {ContentAddressableStore} cas
 * @param {{
 *   source?: DashSource,
 *   scope?: TreemapScope,
 *   worktreeMode?: TreemapWorktreeMode,
 *   drillPath?: TreemapPathNode[],
 * }} [options]
 */
export function loadTreemapCmd(cas, options = {}) {
  const {
    source = { type: 'vault' },
    scope = 'repository',
    worktreeMode = 'tracked',
    drillPath = [],
  } = options;
  return async () => {
    try {
      const report = await buildRepoTreemapReport(cas, { source, scope, worktreeMode, drillPath });
      return /** @type {const} */ ({ type: 'loaded-treemap', report });
    } catch (/** @type {any} */ err) {
      return /** @type {const} */ ({
        type: 'load-error',
        source: 'treemap',
        scopeId: scope,
        worktreeMode,
        drillPath,
        error: /** @type {Error} */ (err).message,
      });
    }
  };
}
