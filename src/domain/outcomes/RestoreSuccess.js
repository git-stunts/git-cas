import { concatBytes } from '../bytes/ByteLayout.js';
import RestoreOutcome from './RestoreOutcome.js';

/**
 * Immutable successful restore result.
 */
export default class RestoreSuccess extends RestoreOutcome {
  #buffer;

  /**
   * @param {{ buffer: Uint8Array }} options
   */
  constructor({ buffer }) {
    super({ ok: true });
    this.#buffer = new Uint8Array(buffer);
    this.bytesWritten = this.#buffer.length;
    Object.freeze(this);
  }

  /**
   * @returns {Uint8Array}
   */
  get buffer() {
    return new Uint8Array(this.#buffer);
  }

  /**
   * @param {Uint8Array[]} chunks
   * @returns {RestoreSuccess}
   */
  static fromChunks(chunks) {
    return new RestoreSuccess({ buffer: concatBytes(chunks) });
  }
}
