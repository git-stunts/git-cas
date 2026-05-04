const HEX = '0123456789abcdef';

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function encodeHex(bytes) {
  let out = '';
  for (const byte of bytes) {
    out += HEX[(byte >>> 4) & 0x0f];
    out += HEX[byte & 0x0f];
  }
  return out;
}
