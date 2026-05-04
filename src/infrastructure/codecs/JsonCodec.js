import CodecPort from '../../ports/CodecPort.js';
import { utf8Decode, utf8Encode } from '../../domain/encoding/utf8.js';

/**
 * {@link CodecPort} implementation that serializes manifests as pretty-printed JSON.
 */
export default class JsonCodec extends CodecPort {
  /**
   * @override
   * @param {Record<string, unknown>} data - Data to encode.
   * @returns {Uint8Array}
   */
  encode(data) {
    // For now, we assume data is JSON-safe or uses toJSON() methods
    return utf8Encode(JSON.stringify(data, null, 2));
  }

  /**
   * @override
   * @param {Uint8Array} buffer - JSON-encoded data.
   * @returns {Record<string, unknown>}
   */
  decode(buffer) {
    return JSON.parse(utf8Decode(buffer));
  }

  /** @override */
  get extension() {
    return 'json';
  }
}
