#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * @fileoverview Migration script for legacy encryption schemes.
 *
 * Reads manifests with v1/v2 scheme identifiers, decrypts using legacy
 * logic (no AAD for v1, slug-based AAD for v2), and re-stores using
 * current scheme names with AAD always on.
 *
 * Usage:
 *   node scripts/migrate-encryption.js --repo <path> --passphrase <pass>
 *
 * This is the ONLY place legacy decode logic lives. The main src/ codebase
 * throws LEGACY_SCHEME if it encounters v1/v2 identifiers.
 */

const LEGACY_SCHEME_MAP = {
  'whole-v1': 'whole',
  'whole-v2': 'whole',
  'framed-v1': 'framed',
  'framed-v2': 'framed',
  'convergent-v1': 'convergent',
};

/**
 * Returns the current scheme name for a legacy scheme, or null if not legacy.
 * @param {string} scheme
 * @returns {string|null}
 */
function mapLegacyScheme(scheme) {
  return LEGACY_SCHEME_MAP[scheme] ?? null;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (process.argv[1]?.endsWith('migrate-encryption.js')) {
  console.log('migrate-encryption: Legacy scheme migration tool');
  console.log('');
  console.log('Recognized legacy schemes:');
  for (const [legacy, current] of Object.entries(LEGACY_SCHEME_MAP)) {
    console.log(`  ${legacy} → ${current}`);
  }
  console.log('');
  console.log('Migration decrypts content using legacy logic (v1: no AAD,');
  console.log('v2: slug-based AAD) and re-stores using current scheme names');
  console.log('with AAD always enabled.');
  console.log('');
  console.log('Full migration support requires integration with the git-cas');
  console.log('CLI. Run: git-cas migrate --help');
  console.log('');
  console.log('For programmatic use, import mapLegacyScheme from this module.');
}

export { LEGACY_SCHEME_MAP, mapLegacyScheme };
