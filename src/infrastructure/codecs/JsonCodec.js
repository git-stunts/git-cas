import CodecPort from '../../ports/CodecPort.js';

/**
 * {@link CodecPort} implementation that serializes manifests as pretty-printed JSON.
 */
export default class JsonCodec extends CodecPort {
  /** @override */
  encode(data) {
    // Determine if we need to handle Buffers specially for JSON
    // For now, we assume data is JSON-safe or uses toJSON() methods
    return JSON.stringify(data, null, 2);
  }

  /** @override */
  decode(buffer) {
    return JSON.parse(buffer.toString('utf8'));
  }

  /** @override */
  get extension() {
    return 'json';
  }
}
