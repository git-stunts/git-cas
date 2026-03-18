/**
 * Async command factories for the vault dashboard.
 */

import { buildVaultStats, inspectVaultHealth } from './vault-report.js';

/** @typedef {import('../../index.js').default} ContentAddressableStore */

/**
 * Load vault entries and metadata in parallel.
 *
 * @param {ContentAddressableStore} cas
 */
export function loadEntriesCmd(cas) {
  return async () => {
    try {
      const [entries, metadata] = await Promise.all([
        cas.listVault(),
        cas.getVaultMetadata(),
      ]);
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
 */
export function loadStatsCmd(cas) {
  return async () => {
    try {
      const entries = await cas.listVault();
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
 */
export function loadDoctorCmd(cas) {
  return async () => {
    try {
      const report = await inspectVaultHealth(cas);
      return /** @type {const} */ ({ type: 'loaded-doctor', report });
    } catch (/** @type {any} */ err) {
      return /** @type {const} */ ({ type: 'load-error', source: 'doctor', error: /** @type {Error} */ (err).message });
    }
  };
}
