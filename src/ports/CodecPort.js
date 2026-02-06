/**
 * Abstract interface for encoding and decoding manifest data.
 * @abstract
 */
export default class CodecPort {
  /**
   * Encodes data to a Buffer or string.
   * @param {Object} data
   * @returns {Buffer|string}
   */
  encode(_data) {
    throw new Error('Not implemented');
  }

  /**
   * Decodes data from a Buffer or string.
   * @param {Buffer|string} buffer
   * @returns {Object}
   */
  decode(_buffer) {
    throw new Error('Not implemented');
  }

  /**
   * Returns the file extension for this codec (e.g. 'json', 'cbor').
   * @returns {string}
   */
  get extension() {
    throw new Error('Not implemented');
  }
}
