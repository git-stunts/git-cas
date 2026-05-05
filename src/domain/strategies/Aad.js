import { writeUint32BE } from '../bytes/ByteLayout.js';
import { utf8Encode } from '../encoding/utf8.js';

/**
 * Builds AAD for whole encryption: UTF-8 bytes of the slug.
 * @param {string} slug
 * @returns {Uint8Array}
 */
export function buildWholeAad(slug) {
  return utf8Encode(slug);
}

/**
 * Builds AAD for framed encryption: UTF-8 slug + NUL + 4-byte BE frame index.
 * @param {string} slug
 * @param {number} frameIndex
 * @returns {Uint8Array}
 */
export function buildFramedAad(slug, frameIndex) {
  const slugBytes = utf8Encode(slug);
  const bytes = new Uint8Array(slugBytes.length + 5);
  bytes.set(slugBytes, 0);
  bytes[slugBytes.length] = 0;
  writeUint32BE(bytes, slugBytes.length + 1, frameIndex);
  return bytes;
}
