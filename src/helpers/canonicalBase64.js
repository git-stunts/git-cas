import { Buffer } from 'node:buffer';

const CANONICAL_BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function isCanonicalBase64(value) {
  return typeof value === 'string'
    && CANONICAL_BASE64_RE.test(value)
    && Buffer.from(value, 'base64').toString('base64') === value;
}
