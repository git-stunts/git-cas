import { describe, it, expect } from 'vitest';
import Oid from '../../../../src/domain/value-objects/Oid.js';
import CasError from '../../../../src/domain/errors/CasError.js';

describe('Oid', () => {
  it('normalizes valid Git object IDs and freezes the value object', () => {
    const oid = new Oid('A'.repeat(40));

    expect(oid.toString()).toBe('a'.repeat(40));
    expect(Object.isFrozen(oid)).toBe(true);
  });

  it('rejects non-hex object IDs with a domain error', () => {
    expect(() => new Oid('not-an-oid')).toThrow(CasError);
    try {
      new Oid('not-an-oid');
    } catch (err) {
      expect(err.code).toBe('INVALID_OID');
    }
  });
});
