import { describe, expect, it } from 'vitest';
import { InvalidOptionsError } from '../../../../src/domain/errors/index.js';
import { buildFramedAad, buildWholeAad } from '../../../../src/domain/strategies/Aad.js';

describe('AAD byte layout', () => {
  it('uses UTF-8 slug bytes for whole-entry authentication data', () => {
    expect([...buildWholeAad('vault/é')]).toEqual([118, 97, 117, 108, 116, 47, 195, 169]);
  });

  it('uses slug bytes, a NUL separator, and a big-endian frame index for framed entries', () => {
    expect([...buildFramedAad('entry', 0x01020304)]).toEqual([
      101, 110, 116, 114, 121, 0, 1, 2, 3, 4,
    ]);
  });

  it('rejects frame indexes outside the uint32 authentication-data range', () => {
    expect(() => buildFramedAad('entry', 0x100000000)).toThrow(InvalidOptionsError);
  });
});
