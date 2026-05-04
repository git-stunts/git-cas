import { describe, expect, it } from 'vitest';
import { utf8ByteLength, utf8Decode, utf8Encode } from '../../../../src/domain/encoding/utf8.js';

describe('utf8 encoding', () => {
  it('encodes, decodes, and counts ASCII', () => {
    const bytes = utf8Encode('git-cas');
    expect([...bytes]).toEqual([103, 105, 116, 45, 99, 97, 115]);
    expect(utf8Decode(bytes)).toBe('git-cas');
    expect(utf8ByteLength('git-cas')).toBe(7);
  });

  it('handles multibyte code points', () => {
    const value = 'slug/π/🚀';
    const bytes = utf8Encode(value);
    expect(utf8Decode(bytes)).toBe(value);
    expect(utf8ByteLength(value)).toBe(bytes.length);
  });
});
