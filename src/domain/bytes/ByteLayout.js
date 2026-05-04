/**
 * Pure byte-array layout helpers for protocol code.
 *
 * These functions intentionally use only ECMAScript typed-array operations.
 * Runtime-specific byte subclasses such as Node's Uint8Array belong in adapters.
 */

/**
 * @param {unknown} value
 * @returns {value is Uint8Array}
 */
export function isBytes(value) {
  return value instanceof Uint8Array;
}

/**
 * @param {unknown} value
 * @param {string} [name]
 * @returns {Uint8Array}
 */
export function assertBytes(value, name = 'value') {
  if (!isBytes(value)) {
    throw new TypeError(`${name} must be a Uint8Array`);
  }
  return value;
}

/**
 * Normalizes a source chunk accepted by core byte streams.
 * @param {unknown} chunk
 * @returns {Uint8Array}
 */
export function normalizeByteChunk(chunk) {
  if (isBytes(chunk)) {
    return chunk;
  }
  throw new TypeError('CAS source chunks must be Uint8Array');
}

/**
 * @param {Uint8Array[]} chunks
 * @param {number} [totalLength]
 * @returns {Uint8Array}
 */
export function concatBytes(chunks, totalLength) {
  const length = totalLength ?? chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * @param {{ source: Uint8Array, target: Uint8Array, targetOffset: number, sourceStart?: number, sourceEnd?: number }} options
 */
export function copyBytes({
  source,
  target,
  targetOffset,
  sourceStart = 0,
  sourceEnd = source.length,
}) {
  target.set(source.subarray(sourceStart, sourceEnd), targetOffset);
}

/**
 * @param {Uint8Array} bytes
 * @param {number} [offset]
 * @returns {number}
 */
export function readUint32BE(bytes, offset = 0) {
  return (
    ((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  ) >>> 0;
}

/**
 * @param {Uint8Array} target
 * @param {number} offset
 * @param {number} value
 */
export function writeUint32BE(target, offset, value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`uint32 value out of range: ${value}`);
  }
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}
