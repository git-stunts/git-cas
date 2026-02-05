import CodecPort from '../../ports/CodecPort.js';

export default class JsonCodec extends CodecPort {
  encode(data) {
    // Determine if we need to handle Buffers specially for JSON
    // For now, we assume data is JSON-safe or uses toJSON() methods
    return JSON.stringify(data, null, 2);
  }

  decode(buffer) {
    return JSON.parse(buffer.toString('utf8'));
  }

  get extension() {
    return 'json';
  }
}
