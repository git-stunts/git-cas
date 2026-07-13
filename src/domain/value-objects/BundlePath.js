import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import { utf8Encode } from '../encoding/utf8.js';

/**
 * Validates and returns one canonical logical bundle member path.
 *
 * @param {unknown} value
 * @param {number} maxBytes
 * @returns {string}
 */
export default function normalizeBundlePath(value, maxBytes) {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(value, 'Bundle member path must be a non-empty string');
  }
  if (value.normalize('NFC') !== value) {
    throw invalid(value, 'Bundle member path must use canonical NFC normalization');
  }
  if (hasInvalidShape(value)) {
    throw invalid(value, 'Bundle member path has an invalid or unsafe shape');
  }
  const bytes = utf8Encode(value).length;
  if (bytes > maxBytes) {
    throw createCasError('Bundle member path exceeds its byte limit', ErrorCodes.BUNDLE_PATH_LIMIT, {
      path: value,
      pathBytes: bytes,
      maxMemberPathBytes: maxBytes,
    });
  }
  return value;
}

function hasInvalidShape(value) {
  if (
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('//') ||
    value.includes('\\') ||
    hasUnpairedSurrogate(value) ||
    hasControlCharacter(value)
  ) {
    return true;
  }
  return value.split('/').some((component) => component === '.' || component === '..');
}

function hasControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      return true;
    }
  }
  return false;
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function invalid(path, message) {
  return createCasError(message, ErrorCodes.BUNDLE_PATH_INVALID, { path });
}
