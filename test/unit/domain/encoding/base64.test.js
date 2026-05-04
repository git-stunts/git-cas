import { describe, expect, it } from 'vitest';
import {
  base64DecodedLength,
  decodeBase64,
  encodeBase64,
  isCanonicalBase64,
} from '../../../../src/domain/encoding/base64.js';

describe('base64 encoding', () => {
  it('round-trips canonical base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = encodeBase64(bytes);

    expect(encoded).toBe('AAEC+vv8/f7/');
    expect([...decodeBase64(encoded)]).toEqual([...bytes]);
    expect(isCanonicalBase64(encoded)).toBe(true);
    expect(base64DecodedLength(encoded)).toBe(bytes.length);
  });

  it('handles padding lengths', () => {
    expect(encodeBase64(new Uint8Array([1]))).toBe('AQ==');
    expect(encodeBase64(new Uint8Array([1, 2]))).toBe('AQI=');
    expect([...decodeBase64('AQ==')]).toEqual([1]);
    expect([...decodeBase64('AQI=')]).toEqual([1, 2]);
  });

  it('rejects non-canonical values', () => {
    expect(isCanonicalBase64('AQ')).toBe(false);
    expect(isCanonicalBase64('AQ===')).toBe(false);
    expect(() => decodeBase64('AQ')).toThrow(/canonical base64/);
  });
});
