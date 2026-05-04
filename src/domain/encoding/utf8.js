const REPLACEMENT = 0xfffd;

/**
 * @param {string} value
 * @returns {number}
 */
export function utf8ByteLength(value) {
  let length = 0;
  for (let i = 0; i < value.length; i++) {
    const codePoint = value.codePointAt(i);
    if (codePoint === undefined) { break; }
    if (codePoint > 0xffff) { i++; }
    length += utf8CodePointLength(codePoint);
  }
  return length;
}

/**
 * @param {string} value
 * @returns {Uint8Array}
 */
export function utf8Encode(value) {
  const out = new Uint8Array(utf8ByteLength(value));
  let offset = 0;

  for (let i = 0; i < value.length; i++) {
    const codePoint = value.codePointAt(i);
    if (codePoint === undefined) { break; }
    if (codePoint > 0xffff) { i++; }
    offset = writeCodePoint(out, offset, codePoint);
  }

  return out;
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
// eslint-disable-next-line complexity
export function utf8Decode(bytes) {
  const parts = [];
  let chunk = '';

  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++];
    let codePoint = REPLACEMENT;

    if (first < 0x80) {
      codePoint = first;
    } else if ((first & 0xe0) === 0xc0 && i < bytes.length) {
      const b1 = bytes[i++];
      const candidate = ((first & 0x1f) << 6) | (b1 & 0x3f);
      codePoint = (b1 & 0xc0) === 0x80 && candidate >= 0x80 ? candidate : REPLACEMENT;
    } else if ((first & 0xf0) === 0xe0 && i + 1 < bytes.length) {
      const b1 = bytes[i++];
      const b2 = bytes[i++];
      const candidate = ((first & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
      codePoint = (b1 & 0xc0) === 0x80 && (b2 & 0xc0) === 0x80 && candidate >= 0x800
        ? candidate
        : REPLACEMENT;
    } else if ((first & 0xf8) === 0xf0 && i + 2 < bytes.length) {
      const b1 = bytes[i++];
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      const candidate = ((first & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
      codePoint = (
        (b1 & 0xc0) === 0x80 &&
        (b2 & 0xc0) === 0x80 &&
        (b3 & 0xc0) === 0x80 &&
        candidate >= 0x10000 &&
        candidate <= 0x10ffff
      ) ? candidate : REPLACEMENT;
    }

    chunk += String.fromCodePoint(codePoint);
    if (chunk.length > 8192) {
      parts.push(chunk);
      chunk = '';
    }
  }

  if (chunk.length > 0) {
    parts.push(chunk);
  }
  return parts.join('');
}

/**
 * @param {number} codePoint
 * @returns {number}
 */
function utf8CodePointLength(codePoint) {
  if (codePoint < 0x80) { return 1; }
  if (codePoint < 0x800) { return 2; }
  if (codePoint < 0x10000) { return 3; }
  return 4;
}

/**
 * @param {Uint8Array} out
 * @param {number} offset
 * @param {number} codePoint
 * @returns {number}
 */
function writeCodePoint(out, offset, codePoint) {
  if (codePoint < 0x80) {
    out[offset++] = codePoint;
  } else if (codePoint < 0x800) {
    out[offset++] = 0xc0 | (codePoint >>> 6);
    out[offset++] = 0x80 | (codePoint & 0x3f);
  } else if (codePoint < 0x10000) {
    out[offset++] = 0xe0 | (codePoint >>> 12);
    out[offset++] = 0x80 | ((codePoint >>> 6) & 0x3f);
    out[offset++] = 0x80 | (codePoint & 0x3f);
  } else {
    out[offset++] = 0xf0 | (codePoint >>> 18);
    out[offset++] = 0x80 | ((codePoint >>> 12) & 0x3f);
    out[offset++] = 0x80 | ((codePoint >>> 6) & 0x3f);
    out[offset++] = 0x80 | (codePoint & 0x3f);
  }
  return offset;
}
