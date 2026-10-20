/**
 * Splits object-metadata requests into windows that every Git metadata
 * transport accepts.
 *
 * Plumbing's persistent cat-file session refuses a request with more than
 * 1000 objects or more than 64 KiB of encoded `info <oid>\n` commands. The
 * command fallback writes shorter `<oid>\n` lines, so the session bound also
 * bounds its stdin. Windows preserve the caller's order exactly.
 */

export const MAX_METADATA_WINDOW_OBJECTS = 1000;
export const MAX_METADATA_WINDOW_COMMAND_BYTES = 64 * 1024;

const COMMAND_PREFIX = 'info ';
const COMMAND_TERMINATOR = '\n';
const ENCODER = new globalThis.TextEncoder();

/**
 * @param {string} objectName
 * @returns {number} Encoded bytes of one cat-file info command.
 */
function commandBytes(objectName) {
  return ENCODER.encode(`${COMMAND_PREFIX}${objectName}${COMMAND_TERMINATOR}`).length;
}

/**
 * @param {ReadonlyArray<string>} objectNames - Object names in request order.
 * @returns {Array<Array<string>>} Ordered, non-empty request windows.
 */
export function metadataRequestWindows(objectNames) {
  const windows = [];
  let current = [];
  let currentBytes = 0;
  for (const objectName of objectNames) {
    const bytes = commandBytes(objectName);
    if (
      current.length > 0 &&
      (current.length >= MAX_METADATA_WINDOW_OBJECTS ||
        currentBytes + bytes > MAX_METADATA_WINDOW_COMMAND_BYTES)
    ) {
      windows.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(objectName);
    currentBytes += bytes;
  }
  if (current.length > 0) {
    windows.push(current);
  }
  return windows;
}
