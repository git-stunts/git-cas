import { utf8ByteLength } from '../encoding/utf8.js';

export const MAX_COLLECTION_KEY_BYTES = 1024;

export default function isCanonicalCollectionKey(value) {
  return typeof value === 'string' &&
    value.length > 0 &&
    isWellFormed(value) &&
    value.normalize('NFC') === value &&
    utf8ByteLength(value) <= MAX_COLLECTION_KEY_BYTES &&
    !hasControl(value);
}

function hasControl(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

function isWellFormed(value) {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}
