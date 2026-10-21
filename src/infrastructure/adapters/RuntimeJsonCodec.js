import JsonCodec from '../codecs/JsonCodec.js';

const decoder = typeof globalThis.TextDecoder === 'function'
  ? new globalThis.TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  : null;

/** Runtime text conversion over the unchanged portable JSON codec contract. */
export default class RuntimeJsonCodec extends JsonCodec {
  decode(buffer) {
    if (decoder && buffer instanceof Uint8Array) {
      let text;
      try {
        text = decoder.decode(buffer);
      } catch {
        // Preserve legacy consumption of malformed UTF-8.
        return super.decode(buffer);
      }
      return JSON.parse(text);
    }
    return super.decode(buffer);
  }
}
