/**
 * Async command factories for the vault dashboard.
 */

/**
 * Load vault entries and metadata in parallel.
 */
export function loadEntriesCmd(cas) {
  return async () => {
    try {
      const [entries, metadata] = await Promise.all([
        cas.listVault(),
        cas.getVaultMetadata(),
      ]);
      return { type: 'loaded-entries', entries, metadata };
    } catch (err) {
      return { type: 'load-error', source: 'entries', error: err.message };
    }
  };
}

/**
 * Load a single manifest by slug and tree OID.
 */
export function loadManifestCmd(cas, slug, treeOid) {
  return async () => {
    try {
      const manifest = await cas.readManifest({ treeOid });
      return { type: 'loaded-manifest', slug, manifest };
    } catch (err) {
      return { type: 'load-error', source: 'manifest', slug, error: err.message };
    }
  };
}
