import CodecPort from '../../ports/CodecPort.js';
import { encode, decode } from 'cbor-x';

/**
 * {@link CodecPort} implementation that serializes manifests as CBOR (binary).
 */
export default class CborCodec extends CodecPort {
  /**
   * @override
   * @param {Record<string, unknown>} data - Data to encode.
   * @returns {Uint8Array}
   */
  encode(data) {
    return encode(data);
  }

  /**
   * @override
   * @param {Uint8Array} buffer - CBOR-encoded data.
   * @returns {Record<string, unknown>}
   */
  decode(buffer) {
    return decode(buffer);
  }

  /** @override */
  get extension() {
    return 'cbor';
  }
}
