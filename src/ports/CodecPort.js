/**
 * Abstract interface for encoding and decoding manifest data.
 * @abstract
 */
export default class CodecPort {
  /**
   * Encodes data to bytes.
   * @param {Record<string, unknown>} _data - Data to encode.
   * @returns {Uint8Array}
   */
  encode(_data) {
    throw new Error('Not implemented');
  }

  /**
   * Decodes data from bytes.
   * @param {Uint8Array} _buffer - Encoded data to decode.
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
