import { concatBytes } from '../bytes/ByteLayout.js';

/**
 * Immutable restore result.
 */
export default class RestoreOutcome {
  /**
   * @param {{ buffer: Uint8Array }} options
   */
  constructor({ buffer }) {
    this.buffer = buffer;
    this.bytesWritten = buffer.length;
    Object.freeze(this);
  }

  /**
   * @param {Uint8Array} buffer
   * @returns {RestoreOutcome}
   */
  static success(buffer) {
    return new RestoreOutcome({ buffer });
  }

  /**
   * @param {Uint8Array[]} chunks
   * @returns {RestoreOutcome}
   */
  static fromChunks(chunks) {
    return RestoreOutcome.success(concatBytes(chunks));
  }
}
