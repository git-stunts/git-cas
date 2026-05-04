const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CANONICAL_BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** @type {Map<string, number>} */
const DECODE = new Map([...ALPHABET].map((char, index) => [char, index]));

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function encodeBase64(bytes) {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHABET[(n >>> 18) & 0x3f];
    out += ALPHABET[(n >>> 12) & 0x3f];
    out += ALPHABET[(n >>> 6) & 0x3f];
    out += ALPHABET[n & 0x3f];
  }
  if (i < bytes.length) {
    const remaining = bytes.length - i;
    const n = (bytes[i] << 16) | (remaining === 2 ? bytes[i + 1] << 8 : 0);
    out += ALPHABET[(n >>> 18) & 0x3f];
    out += ALPHABET[(n >>> 12) & 0x3f];
    out += remaining === 2 ? ALPHABET[(n >>> 6) & 0x3f] : '=';
    out += '=';
  }
  return out;
}

/**
 * @param {string} value
 * @returns {number}
 */
export function base64DecodedLength(value) {
  if (!CANONICAL_BASE64_RE.test(value)) {
    throw new TypeError('value must be canonical base64');
  }
  if (value.length === 0) {
    return 0;
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

/**
 * @param {string} value
 * @returns {Uint8Array}
 */
export function decodeBase64(value) {
  const out = new Uint8Array(base64DecodedLength(value));
  let outPos = 0;

  for (let i = 0; i < value.length; i += 4) {
    const c0 = decodeChar(value[i]);
    const c1 = decodeChar(value[i + 1]);
    const c2 = value[i + 2] === '=' ? 0 : decodeChar(value[i + 2]);
    const c3 = value[i + 3] === '=' ? 0 : decodeChar(value[i + 3]);
    const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;

    if (outPos < out.length) { out[outPos++] = (n >>> 16) & 0xff; }
    if (outPos < out.length) { out[outPos++] = (n >>> 8) & 0xff; }
    if (outPos < out.length) { out[outPos++] = n & 0xff; }
  }

  return out;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isCanonicalBase64(value) {
  if (typeof value !== 'string' || !CANONICAL_BASE64_RE.test(value)) {
    return false;
  }
  return encodeBase64(decodeBase64(value)) === value;
}

/**
 * @param {string} char
 * @returns {number}
 */
function decodeChar(char) {
  const decoded = DECODE.get(char);
  if (decoded === undefined) {
    throw new TypeError('value must be canonical base64');
  }
  return decoded;
}
