import CodecPort from '../../ports/CodecPort.js';
import { encode, decode } from 'cbor-x';

export default class CborCodec extends CodecPort {
  encode(data) {
    return encode(data);
  }

  decode(buffer) {
    return decode(buffer);
  }

  get extension() {
    return 'cbor';
  }
}
