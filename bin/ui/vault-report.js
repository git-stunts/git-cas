/**
 * Shared reporting helpers for vault diagnostics commands.
 */

/**
 * @typedef {{ slug: string, treeOid: string, manifest: { toJSON?: () => any } | Record<string, any> }} VaultRecord
 * @typedef {{
 *   entries: number,
 *   totalLogicalSize: number,
 *   totalChunkRefs: number,
 *   uniqueChunks: number,
 *   duplicateChunkRefs: number,
 *   dedupRatio: number,
 *   encryptedEntries: number,
 *   envelopeEntries: number,
 *   compressedEntries: number,
 *   chunkingStrategies: Record<string, number>,
 *   largestEntry: { slug: string, size: number } | null,
 * }} VaultStats
 * @typedef {{
 *   scope: 'vault' | 'entry',
 *   code: string,
 *   message: string,
 *   slug?: string,
 *   treeOid?: string,
 * }} DoctorIssue
 * @typedef {{
 *   status: 'ok' | 'warn' | 'fail',
 *   hasVault: boolean,
 *   commitOid: string | null,
 *   entryCount: number,
 *   checkedEntries: number,
 *   validEntries: number,
 *   invalidEntries: number,
 *   metadataEncrypted: boolean,
 *   stats: VaultStats,
 *   issues: DoctorIssue[],
 * }} DoctorReport
 */

/**
 * Normalize a manifest-like value to plain JSON data.
 *
 * @param {{ toJSON?: () => any } | Record<string, any>} manifest
 * @returns {Record<string, any>}
 */
function toManifestData(manifest) {
  return typeof manifest?.toJSON === 'function' ? manifest.toJSON() : manifest;
}

/**
 * Format a byte count using binary units.
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 bytes';
  }
  if (bytes < 1024) {
    return `${bytes} bytes`;
  }

  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Render aligned key/value pairs without tabs so TUI panels stay stable.
 *
 * @param {Array<[string, string | number]>} pairs
 * @returns {string[]}
 */
function renderKeyValueLines(pairs) {
  const labelWidth = pairs.reduce((max, [label]) => Math.max(max, label.length), 0);
  return pairs.map(([label, value]) => `${label.padEnd(labelWidth)} ${value}`);
}

/**
 * Create an empty stats payload.
 *
 * @returns {VaultStats}
 */
function emptyVaultStats() {
  return {
    entries: 0,
    totalLogicalSize: 0,
    totalChunkRefs: 0,
    uniqueChunks: 0,
    duplicateChunkRefs: 0,
    dedupRatio: 1,
    encryptedEntries: 0,
    envelopeEntries: 0,
    compressedEntries: 0,
    chunkingStrategies: {},
    largestEntry: null,
  };
}

/**
 * Return true when manifest uses envelope recipients.
 *
 * @param {Record<string, any>} manifest
 * @returns {boolean}
 */
function hasEnvelopeRecipients(manifest) {
  return Array.isArray(manifest.encryption?.recipients) && manifest.encryption.recipients.length > 0;
}

/**
 * Return true when manifest is encrypted.
 *
 * @param {Record<string, any>} manifest
 * @returns {boolean}
 */
function isEncryptedManifest(manifest) {
  return Boolean(manifest.encryption?.encrypted || hasEnvelopeRecipients(manifest));
}

/**
 * Extract valid chunk blob OIDs from a manifest.
 *
 * @param {Record<string, any>} manifest
 * @returns {string[]}
 */
function listChunkBlobs(manifest) {
  const chunks = Array.isArray(manifest.chunks) ? manifest.chunks : [];
  return chunks
    .map((chunk) => (typeof chunk?.blob === 'string' ? chunk.blob : ''))
    .filter(Boolean);
}

/**
 * Summarize a single vault record for aggregation.
 *
 * @param {VaultRecord} record
 * @returns {{
 *   slug: string,
 *   size: number,
 *   strategy: string,
 *   chunkBlobs: string[],
 *   chunkRefs: number,
 *   encrypted: boolean,
 *   envelope: boolean,
 *   compressed: boolean,
 * }}
 */
function summarizeRecord(record) {
  const manifest = toManifestData(record.manifest);
  const chunks = Array.isArray(manifest.chunks) ? manifest.chunks : [];
  return {
    slug: record.slug,
    size: Number.isFinite(manifest.size) ? manifest.size : 0,
    strategy: manifest.chunking?.strategy ?? 'fixed',
    chunkBlobs: listChunkBlobs(manifest),
    chunkRefs: chunks.length,
    encrypted: isEncryptedManifest(manifest),
    envelope: hasEnvelopeRecipients(manifest),
    compressed: Boolean(manifest.compression),
  };
}

/**
 * Merge a summarized record into aggregate stats.
 *
 * @param {VaultStats} stats
 * @param {ReturnType<typeof summarizeRecord>} summary
 * @param {Set<string>} uniqueChunks
 * @returns {void}
 */
function applyRecordSummary(stats, summary, uniqueChunks) {
  stats.entries += 1;
  stats.totalLogicalSize += summary.size;
  stats.totalChunkRefs += summary.chunkRefs;
  if (summary.encrypted) { stats.encryptedEntries += 1; }
  if (summary.envelope) { stats.envelopeEntries += 1; }
  if (summary.compressed) { stats.compressedEntries += 1; }
  stats.chunkingStrategies[summary.strategy] = (stats.chunkingStrategies[summary.strategy] ?? 0) + 1;

  if (!stats.largestEntry || summary.size > stats.largestEntry.size) {
    stats.largestEntry = { slug: summary.slug, size: summary.size };
  }

  for (const blob of summary.chunkBlobs) {
    uniqueChunks.add(blob);
  }
}

/**
 * Build aggregate vault stats from loaded manifests.
 *
 * Fixed chunking is implicit in current manifests, so missing chunking metadata
 * is treated as `fixed`.
 *
 * @param {VaultRecord[]} records
 * @returns {VaultStats}
 */
export function buildVaultStats(records) {
  /** @type {VaultStats} */
  const stats = emptyVaultStats();
  const uniqueChunks = new Set();

  for (const record of records) {
    applyRecordSummary(stats, summarizeRecord(record), uniqueChunks);
  }

  stats.uniqueChunks = uniqueChunks.size;
  stats.duplicateChunkRefs = Math.max(0, stats.totalChunkRefs - stats.uniqueChunks);
  stats.dedupRatio = stats.uniqueChunks > 0
    ? stats.totalChunkRefs / stats.uniqueChunks
    : 1;

  return stats;
}

/**
 * Render a human-readable vault stats report.
 *
 * @param {VaultStats} stats
 * @returns {string}
 */
export function renderVaultStats(stats) {
  const chunking = Object.entries(stats.chunkingStrategies)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([strategy, count]) => `${strategy}:${count}`)
    .join(', ') || '-';

  const largest = stats.largestEntry
    ? `${stats.largestEntry.slug} (${stats.largestEntry.size} bytes)`
    : '-';

  return [
    ...renderKeyValueLines([
      ['entries', stats.entries],
      ['logical-size', `${formatBytes(stats.totalLogicalSize)} (${stats.totalLogicalSize} bytes)`],
      ['chunk-refs', stats.totalChunkRefs],
      ['unique-chunks', stats.uniqueChunks],
      ['duplicate-refs', stats.duplicateChunkRefs],
      ['dedup-ratio', `${stats.dedupRatio.toFixed(2)}x`],
      ['encrypted', stats.encryptedEntries],
      ['envelope', stats.envelopeEntries],
      ['compressed', stats.compressedEntries],
      ['chunking', chunking],
      ['largest', largest],
    ]),
    '',
  ].join('\n');
}

/**
 * Normalize thrown errors into doctor issue entries.
 *
 * @param {DoctorIssue['scope']} scope
 * @param {unknown} error
 * @param {{ slug?: string, treeOid?: string }} [meta]
 * @returns {DoctorIssue}
 */
function toDoctorIssue(scope, error, meta = {}) {
  const code = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'UNKNOWN_ERROR';
  const message = error instanceof Error ? error.message : String(error);
  return { scope, code, message, ...meta };
}

/**
 * Build the failure report for vault-level errors.
 *
 * @param {unknown} error
 * @returns {DoctorReport}
 */
function buildDoctorFailureReport(error) {
  return {
    status: 'fail',
    hasVault: true,
    commitOid: null,
    entryCount: 0,
    checkedEntries: 0,
    validEntries: 0,
    invalidEntries: 1,
    metadataEncrypted: false,
    stats: emptyVaultStats(),
    issues: [toDoctorIssue('vault', error)],
  };
}

/**
 * Build the report for a missing vault ref.
 *
 * @returns {DoctorReport}
 */
function buildMissingVaultReport() {
  return {
    status: 'warn',
    hasVault: false,
    commitOid: null,
    entryCount: 0,
    checkedEntries: 0,
    validEntries: 0,
    invalidEntries: 0,
    metadataEncrypted: false,
    stats: emptyVaultStats(),
    issues: [{
      scope: 'vault',
      code: 'VAULT_REF_MISSING',
      message: 'refs/cas/vault not found',
    }],
  };
}

/**
 * Read the current vault state.
 *
 * @param {{ getVaultService: () => Promise<{ readState: () => Promise<{ entries: Map<string, string>, parentCommitOid: string | null, metadata: Record<string, any> | null }> }> }} cas
 * @returns {Promise<{ entries: Map<string, string>, parentCommitOid: string | null, metadata: Record<string, any> | null }>}
 */
async function readVaultState(cas) {
  const vault = await cas.getVaultService();
  return await vault.readState();
}

/**
 * Load doctor entry records while keeping per-entry failures as issues.
 *
 * @param {{ readManifest: ({ treeOid }: { treeOid: string }) => Promise<any> }} cas
 * @param {Array<{ slug: string, treeOid: string }>} entries
 * @returns {Promise<{ records: VaultRecord[], issues: DoctorIssue[] }>}
 */
async function readDoctorEntries(cas, entries) {
  /** @type {VaultRecord[]} */
  const records = [];
  /** @type {DoctorIssue[]} */
  const issues = [];

  for (const entry of entries) {
    try {
      const manifest = await cas.readManifest({ treeOid: entry.treeOid });
      records.push({ ...entry, manifest });
    } catch (error) {
      issues.push(toDoctorIssue('entry', error, entry));
    }
  }

  return { records, issues };
}

/**
 * Inspect vault health without aborting on per-entry failures.
 *
 * @param {{
 *   getVaultService: () => Promise<{ readState: () => Promise<{ entries: Map<string, string>, parentCommitOid: string | null, metadata: Record<string, any> | null }> }>,
 *   readManifest: ({ treeOid }: { treeOid: string }) => Promise<any>,
 * }} cas
 * @returns {Promise<DoctorReport>}
 */
export async function inspectVaultHealth(cas) {
  let state;

  try {
    state = await readVaultState(cas);
  } catch (error) {
    return buildDoctorFailureReport(error);
  }

  if (!state.parentCommitOid) {
    return buildMissingVaultReport();
  }

  const entries = [...state.entries.entries()]
    .map(([slug, treeOid]) => ({ slug, treeOid }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
  const { records, issues } = await readDoctorEntries(cas, entries);

  return {
    status: issues.length > 0 ? 'fail' : 'ok',
    hasVault: true,
    commitOid: state.parentCommitOid,
    entryCount: entries.length,
    checkedEntries: entries.length,
    validEntries: records.length,
    invalidEntries: issues.length,
    metadataEncrypted: Boolean(state.metadata?.encryption),
    stats: buildVaultStats(records),
    issues,
  };
}

/**
 * Render a human-readable doctor report.
 *
 * @param {DoctorReport} report
 * @returns {string}
 */
export function renderDoctorReport(report) {
  const lines = [
    ...renderKeyValueLines([
      ['status', report.status],
      ['vault', report.hasVault ? 'present' : 'missing'],
      ['commit', report.commitOid ?? '-'],
      ['entries', report.entryCount],
      ['checked', report.checkedEntries],
      ['valid', report.validEntries],
      ['invalid', report.invalidEntries],
      ['metadata', report.metadataEncrypted ? 'encrypted' : 'plain'],
      ['issues', report.issues.length],
      ['logical-size', `${formatBytes(report.stats.totalLogicalSize)} (${report.stats.totalLogicalSize} bytes)`],
      ['chunk-refs', report.stats.totalChunkRefs],
      ['unique-chunks', report.stats.uniqueChunks],
    ]),
    '',
  ];

  if (report.issues.length > 0) {
    lines.push('issue-details');
    for (const issue of report.issues) {
      if (issue.scope === 'entry') {
        lines.push(`[entry] ${issue.slug} (${issue.treeOid}) ${issue.code}: ${issue.message}`);
      } else {
        lines.push(`[vault] ${issue.code}: ${issue.message}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
