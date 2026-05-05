/**
 * @fileoverview Git tree-entry formatting helpers for CAS manifest publication.
 */

const BLOB_FILE_MODE = '100644';
const BLOB_TYPE = 'blob';

/**
 * Format one Git tree entry for a blob.
 *
 * @param {{ oid: string, name: string }} options
 * @returns {string}
 */
export function formatBlobTreeEntry({ oid, name }) {
  return `${BLOB_FILE_MODE} ${BLOB_TYPE} ${oid}\t${name}`;
}

/**
 * Build the manifest blob entry.
 *
 * @param {{ oid: string, extension: string }} options
 * @returns {string}
 */
export function buildManifestTreeEntry({ oid, extension }) {
  return formatBlobTreeEntry({ oid, name: `manifest.${extension}` });
}

/**
 * Build one entry per unique chunk digest, preserving first-seen order.
 *
 * @param {Array<{ digest: string, blob: string }>} chunks
 * @returns {string[]}
 */
export function buildChunkTreeEntries(chunks) {
  const treeEntries = [];
  const seenDigests = new Set();

  for (const chunk of chunks) {
    if (seenDigests.has(chunk.digest)) {
      continue;
    }
    seenDigests.add(chunk.digest);
    treeEntries.push(formatBlobTreeEntry({ oid: chunk.blob, name: chunk.digest }));
  }

  return treeEntries;
}

/**
 * Build entries for sub-manifest blobs.
 *
 * @param {{ subManifests: Array<{ oid: string }>, extension: string }} options
 * @returns {string[]}
 */
export function buildSubManifestTreeEntries({ subManifests, extension }) {
  return subManifests.map((ref, index) =>
    formatBlobTreeEntry({ oid: ref.oid, name: `sub-manifest-${index}.${extension}` })
  );
}

/**
 * Build a flat manifest tree layout.
 *
 * @param {{ manifestOid: string, chunks: Array<{ digest: string, blob: string }>, extension: string }} options
 * @returns {string[]}
 */
export function buildFlatManifestTreeEntries({ manifestOid, chunks, extension }) {
  return [
    buildManifestTreeEntry({ oid: manifestOid, extension }),
    ...buildChunkTreeEntries(chunks),
  ];
}

/**
 * Build a Merkle manifest tree layout.
 *
 * @param {{ rootManifestOid: string, subManifests: Array<{ oid: string }>, chunks: Array<{ digest: string, blob: string }>, extension: string }} options
 * @returns {string[]}
 */
export function buildMerkleTreeEntries({ rootManifestOid, subManifests, chunks, extension }) {
  return [
    buildManifestTreeEntry({ oid: rootManifestOid, extension }),
    ...buildSubManifestTreeEntries({ subManifests, extension }),
    ...buildChunkTreeEntries(chunks),
  ];
}
