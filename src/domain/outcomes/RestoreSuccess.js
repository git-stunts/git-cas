import { concatBytes } from '../bytes/ByteLayout.js';
import RestoreOutcome from './RestoreOutcome.js';

/**
 * Immutable successful restore result.
 */
export default class RestoreSuccess extends RestoreOutcome {
  /**
   * @param {{ buffer: Uint8Array }} options
   */
  constructor({ buffer }) {
    super({ ok: true });
    this.buffer = buffer;
    this.bytesWritten = buffer.length;
    Object.freeze(this);
  }

  /**
   * @param {Uint8Array[]} chunks
   * @returns {RestoreSuccess}
   */
  static fromChunks(chunks) {
    return new RestoreSuccess({ buffer: concatBytes(chunks) });
  }
}
