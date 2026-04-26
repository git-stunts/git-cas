import CasError from '../domain/errors/CasError.js';

export const AES_GCM_ALGORITHM = 'aes-256-gcm';
export const AES_GCM_NONCE_BYTES = 12;
export const AES_GCM_TAG_BYTES = 16;

const CANONICAL_BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function encodeBase64(bytes) {
  if (globalThis.Buffer) {
    return Buffer.from(bytes).toString('base64');
  }
  return globalThis.btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function decodeBase64(value) {
  if (globalThis.Buffer) {
    return Buffer.from(value, 'base64');
  }
  return Uint8Array.from(globalThis.atob(value), (char) => char.charCodeAt(0));
}

function invalidMeta(message, meta) {
  return new CasError(`Invalid AES-GCM metadata: ${message}`, 'INTEGRITY_ERROR', {
    reason: 'invalid-encryption-meta',
    ...meta,
  });
}

function decodeField(field, value, byteLength) {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidMeta(`${field} must be a non-empty base64 string`, { field });
  }
  if (!CANONICAL_BASE64_RE.test(value)) {
    throw invalidMeta(`${field} must be canonical base64`, { field });
  }
  const decoded = decodeBase64(value);
  if (encodeBase64(decoded) !== value) {
    throw invalidMeta(`${field} must be canonical base64`, { field });
  }
  if (decoded.length !== byteLength) {
    throw invalidMeta(`${field} must decode to ${byteLength} bytes`, {
      field,
      expected: byteLength,
      actual: decoded.length,
    });
  }
  return decoded;
}

export default function validateAesGcmMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    throw invalidMeta('metadata object is required');
  }
  if (meta.encrypted !== true) {
    throw invalidMeta('encrypted must be true', { field: 'encrypted' });
  }
  if (meta.algorithm !== AES_GCM_ALGORITHM) {
    throw invalidMeta(`algorithm must be ${AES_GCM_ALGORITHM}`, {
      field: 'algorithm',
      algorithm: meta.algorithm,
    });
  }

  return {
    nonce: decodeField('nonce', meta.nonce, AES_GCM_NONCE_BYTES),
    tag: decodeField('tag', meta.tag, AES_GCM_TAG_BYTES),
  };
}
