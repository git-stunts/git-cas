/**
 * Abstract interface for encoding and decoding manifest data.
 * @abstract
 */
export default class CodecPort {
  /**
   * Encodes data to a Buffer or string.
   * @param {Record<string, unknown>} _data - Data to encode.
   * @returns {Buffer|string}
   */
  encode(_data) {
    throw new Error('Not implemented');
  }

  /**
   * Decodes data from a Buffer or string.
   * @param {Buffer|string} _buffer - Encoded data to decode.
   * @returns {Record<string, unknown>}
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
