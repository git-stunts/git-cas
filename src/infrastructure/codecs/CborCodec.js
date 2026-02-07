import CodecPort from '../../ports/CodecPort.js';
import { encode, decode } from 'cbor-x';

/**
 * {@link CodecPort} implementation that serializes manifests as CBOR (binary).
 */
export default class CborCodec extends CodecPort {
  /** @override */
  encode(data) {
    return encode(data);
  }

  /** @override */
  decode(buffer) {
    return decode(buffer);
  }

  /** @override */
  get extension() {
    return 'cbor';
  }
}
