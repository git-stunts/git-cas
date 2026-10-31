import JsonCodec from '../codecs/JsonCodec.js';

const decoder = createFatalDecoder();

/** Builds without ICU reject `fatal`; the portable decoder then handles all input. */
function createFatalDecoder() {
  if (typeof globalThis.TextDecoder !== 'function') { return null; }
  try {
    return new globalThis.TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  } catch {
    return null;
  }
}

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
