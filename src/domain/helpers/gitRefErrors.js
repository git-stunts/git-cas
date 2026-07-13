const GIT_REV_PARSE = 'rev-parse';
const GIT_REF_NOT_FOUND_STATUS = 128;

const MISSING_REF_MARKERS = Object.freeze({
  ambiguousArgument: 'ambiguous argument',
  neededSingleRevision: 'needed a single revision',
  unknownRevision: 'unknown revision',
});

/**
 * @param {unknown} err
 * @param {string} ref
 * @returns {boolean}
 */
export function isGitMissingRefError(err, ref) {
  return isStdoutOnlyRevParseMiss(errorDetails(err), ref) ||
    isGitMissingRefMessage(errorDetailsText(err), ref);
}

/**
 * @param {unknown} err
 * @returns {string}
 */
export function errorDetailsText(err) {
  if (!(err instanceof Error)) {
    return String(err);
  }
  const details = errorDetails(err);
  return [
    err.message,
    typeof details.stderr === 'string' ? details.stderr : '',
    typeof details.stdout === 'string' ? details.stdout : '',
  ].join('\n');
}

/**
 * @param {unknown} err
 * @returns {Record<string, unknown>}
 */
function errorDetails(err) {
  return err instanceof Error && typeof err.details === 'object' && err.details
    ? err.details
    : {};
}

/**
 * @param {Record<string, unknown>} details
 * @param {string} ref
 * @returns {boolean}
 */
function isStdoutOnlyRevParseMiss(details, ref) {
  // Some plumbing runners surface a stdout-only `rev-parse <ref>` miss: Git
  // exits 128 and echoes the unresolved ref without emitting locale text.
  return details.code === GIT_REF_NOT_FOUND_STATUS &&
    Array.isArray(details.args) &&
    details.args[0] === GIT_REV_PARSE &&
    details.args.at(-1) === ref &&
    typeof details.stdout === 'string' &&
    details.stdout.trim() === ref &&
    `${details.stderr ?? ''}`.trim() === '';
}

/**
 * @param {string} message
 * @param {string} ref
 * @returns {boolean}
 */
function isGitMissingRefMessage(message, ref) {
  const normalized = message.toLowerCase();
  const normalizedRef = ref.toLowerCase();
  if (!normalized.includes(normalizedRef)) {
    return false;
  }
  // C/English-locale missing-ref fallback: normal adapters should return
  // GIT_REF_NOT_FOUND. This best-effort fallback is only for third-party ports
  // that expose Git stderr without a structured code.
  return (
    normalized.includes(MISSING_REF_MARKERS.neededSingleRevision) ||
    (
      normalized.includes(MISSING_REF_MARKERS.ambiguousArgument) &&
      normalized.includes(MISSING_REF_MARKERS.unknownRevision)
    )
  );
}
