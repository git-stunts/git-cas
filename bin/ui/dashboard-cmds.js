/**
 * Async command factories for the vault dashboard.
 */

import { buildVaultStats, inspectVaultHealth } from './vault-report.js';

/** @typedef {import('../../index.js').default} ContentAddressableStore */
/** @typedef {{ type: 'vault' } | { type: 'ref', ref: string } | { type: 'oid', treeOid: string }} DashSource */
/** @typedef {{ slug: string, treeOid: string }} ExplorerEntry */

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
