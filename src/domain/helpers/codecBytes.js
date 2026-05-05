import CasError from '../errors/CasError.js';
import { utf8Encode } from '../encoding/utf8.js';

/**
 * @param {unknown} value
 * @returns {Uint8Array}
 */
export function normalizeCodecBytes(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (typeof value === 'string') {
    return utf8Encode(value);
  }
  throw new CasError('Codec output must be Uint8Array', 'INVALID_OPTIONS');
}

/**
 * Strips `manifestHash` and `undefined` values, then returns codec-encoded bytes.
 * @param {Record<string, unknown>} data
 * @param {{ encode: (value: object) => Uint8Array|string }} codec
 * @returns {Uint8Array}
 */
export function encodeForHash(data, codec) {
  const copy = { ...data };
  delete copy.manifestHash;
  for (const key of Object.keys(copy)) {
    if (copy[key] === undefined) {
      delete copy[key];
    }
  }
  return normalizeCodecBytes(codec.encode(copy));
}
