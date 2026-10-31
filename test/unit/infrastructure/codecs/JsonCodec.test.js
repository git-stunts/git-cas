import { afterEach, describe, expect, it, vi } from 'vitest';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import RuntimeJsonCodec from '../../../../src/infrastructure/adapters/RuntimeJsonCodec.js';
import { utf8Decode, utf8Encode } from '../../../../src/domain/encoding/utf8.js';

const codec = new RuntimeJsonCodec();

function legacyResult(bytes) {
  try {
    return { value: JSON.parse(utf8Decode(bytes)) };
  } catch (error) {
    return { error: error.name };
  }
}

function result(bytes) {
  try {
    return { value: codec.decode(bytes) };
  } catch (error) {
    return { error: error.name };
  }
}

describe('JSON metadata decoding compatibility', () => {
  it('remains a compatible JsonCodec', () => { expect(codec).toBeInstanceOf(JsonCodec); });
  it.each(['ASCII', 'café', '日本語/🧵.md', '\ufeff', '\ud800', 'λ'.repeat(10_000)])(
    'round trips Unicode and offset views, case %#', (text) => {
      const value = { path: text, values: [null, true, 42] };
      const bytes = codec.encode(value);
      const backing = new Uint8Array(bytes.length + 6);
      backing.set(bytes, 3);
      expect(codec.decode(backing.subarray(3, -3))).toEqual(value);
      expect(bytes).toEqual(utf8Encode(JSON.stringify(value, null, 2)));
    }
  );

  it('preserves leading BOM rejection', () => {
    expect(() => codec.decode(Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])))
      .toThrow(SyntaxError);
  });

  it.each([[0xc0, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80],
    [0xe2, 0x28, 0xa1], [0xff], [0xe2], [0xf0, 0x9f], [0x80]])(
    'preserves legacy malformed-byte consumption: %j', (...middle) => {
      const bytes = Uint8Array.from([0x22, ...middle, 0x22]);
      expect(result(bytes)).toEqual(legacyResult(bytes));
      expect(codec.decode(utf8Encode('{"ok":true}'))).toEqual({ ok: true });
    }
  );

  it('matches legacy decoding on a deterministic malformed-byte corpus', () => {
    let state = 0x319d42;
    for (let n = 0; n < 4096; n++) {
      const bytes = new Uint8Array(n % 31);
      for (let i = 0; i < bytes.length; i++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        bytes[i] = state & 255;
      }
      expect(result(bytes)).toEqual(legacyResult(bytes));
      const wrapped = Uint8Array.from([0x22, ...bytes, 0x22]);
      expect(result(wrapped)).toEqual(legacyResult(wrapped));
    }
  });
});

describe('JSON metadata decoding without a fatal UTF-8 decoder', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('loads and decodes when TextDecoder rejects the fatal option', async () => {
    vi.stubGlobal('TextDecoder', class { constructor() { throw new TypeError('ERR_NO_ICU'); } });
    vi.resetModules();
    const { default: Fallback } = await import('../../../../src/infrastructure/adapters/RuntimeJsonCodec.js');
    expect(new Fallback().decode(utf8Encode('{"path":"café"}'))).toEqual({ path: 'café' });
  });
});
