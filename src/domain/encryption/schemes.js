import { ErrorCodes } from '../errors/index.js';
/**
 * @fileoverview Single source of truth for encryption scheme identifiers.
 *
 * Current schemes only. Legacy schemes are recognized solely to produce
 * actionable error messages pointing users to the migration script.
 */
import CasError from '../errors/CasError.js';

// ---------------------------------------------------------------------------
// Current schemes — the only values src/ ever produces or accepts
// ---------------------------------------------------------------------------

export const SCHEME_WHOLE = 'whole';
export const SCHEME_FRAMED = 'framed';
export const SCHEME_CONVERGENT = 'convergent';

export const CURRENT_SCHEMES = new Set([
  SCHEME_WHOLE,
  SCHEME_FRAMED,
  SCHEME_CONVERGENT,
]);

// ---------------------------------------------------------------------------
// Legacy schemes — recognized only to explode with guidance
// ---------------------------------------------------------------------------

const LEGACY_SCHEMES = new Set([
  'whole-v1',
  'whole-v2',
  'framed-v1',
  'framed-v2',
  'convergent-v1',
]);

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/**
 * Throws if the scheme is legacy or unknown. Pass-through for current schemes.
 *
 * @param {string} scheme
 * @throws {CasError} LEGACY_SCHEME if a v1/v2 scheme is encountered.
 * @throws {CasError} INVALID_ENCRYPTION_SCHEME if completely unknown.
 */
export function assertCurrentScheme(scheme) {
  if (CURRENT_SCHEMES.has(scheme)) { return; }

  if (LEGACY_SCHEMES.has(scheme)) {
    throw new CasError(
      `Legacy encryption scheme "${scheme}" is no longer supported. ` +
      'Run scripts/migrate-encryption.js to upgrade this manifest.',
      ErrorCodes.LEGACY_SCHEME,
      { scheme },
    );
  }

  throw new CasError(
    `Unknown encryption scheme "${scheme}"`,
    ErrorCodes.INVALID_ENCRYPTION_SCHEME,
    { scheme },
  );
}

/**
 * Returns true if the scheme string is a recognized legacy identifier.
 *
 * @param {string} scheme
 * @returns {boolean}
 */
export function isLegacyScheme(scheme) {
  return LEGACY_SCHEMES.has(scheme);
}

// ---------------------------------------------------------------------------
// Legacy → current mapping
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} */
const LEGACY_SCHEME_MAP = {
  'whole-v1': SCHEME_WHOLE,
  'whole-v2': SCHEME_WHOLE,
  'framed-v1': SCHEME_FRAMED,
  'framed-v2': SCHEME_FRAMED,
  'convergent-v1': SCHEME_CONVERGENT,
};

/**
 * Maps a legacy scheme identifier to its current name.
 * Returns `null` if the input is not a recognized legacy scheme.
 *
 * @param {string} scheme
 * @returns {string|null}
 */
export function mapToCurrentScheme(scheme) {
  return LEGACY_SCHEME_MAP[scheme] ?? null;
}

/**
 * Returns true if the legacy scheme used no AAD (all v1 variants).
 *
 * @param {string} scheme - A legacy scheme identifier.
 * @returns {boolean}
 */
export function isLegacyNoAad(scheme) {
  return scheme === 'whole-v1' ||
    scheme === 'framed-v1' ||
    scheme === 'convergent-v1';
}

// ---------------------------------------------------------------------------
// Pipeline classification
// ---------------------------------------------------------------------------

/**
 * @typedef {'pre-chunk'|'post-chunk'} TransformPosition
 */

/**
 * Returns where in the pipeline a scheme's encryption happens.
 *
 * - `pre-chunk`: encryption wraps the source stream BEFORE chunking (whole, framed)
 * - `post-chunk`: encryption is applied to each chunk AFTER chunking (convergent)
 *
 * @param {string} scheme - A current scheme identifier.
 * @returns {TransformPosition}
 */
export function schemePipelinePosition(scheme) {
  assertCurrentScheme(scheme);
  return scheme === SCHEME_CONVERGENT ? 'post-chunk' : 'pre-chunk';
}
