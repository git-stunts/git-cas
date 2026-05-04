import { describe, it, expect } from 'vitest';
import {
  SCHEME_WHOLE, SCHEME_FRAMED, SCHEME_CONVERGENT, CURRENT_SCHEMES,
  assertCurrentScheme, isLegacyScheme, schemePipelinePosition,
  mapToCurrentScheme, isLegacyNoAad,
} from '../../../../src/domain/encryption/schemes.js';

describe('scheme constants', () => {
  it('exports three current schemes', () => {
    expect(SCHEME_WHOLE).toBe('whole');
    expect(SCHEME_FRAMED).toBe('framed');
    expect(SCHEME_CONVERGENT).toBe('convergent');
    expect(CURRENT_SCHEMES.size).toBe(3);
  });
});

describe('assertCurrentScheme', () => {
  it('passes for current schemes', () => {
    expect(() => assertCurrentScheme('whole')).not.toThrow();
    expect(() => assertCurrentScheme('framed')).not.toThrow();
    expect(() => assertCurrentScheme('convergent')).not.toThrow();
  });

  it.each([
    'whole-v1', 'whole-v2', 'framed-v1', 'framed-v2', 'convergent-v1',
  ])('throws LEGACY_SCHEME for "%s"', (scheme) => {
    try {
      assertCurrentScheme(scheme);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.code).toBe('LEGACY_SCHEME');
      expect(err.message).toMatch(/migrate/i);
    }
  });

  it('throws INVALID_ENCRYPTION_SCHEME for unknown', () => {
    try {
      assertCurrentScheme('aes-cbc');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.code).toBe('INVALID_ENCRYPTION_SCHEME');
    }
  });
});

describe('isLegacyScheme', () => {
  it('returns true for legacy schemes', () => {
    expect(isLegacyScheme('whole-v1')).toBe(true);
    expect(isLegacyScheme('framed-v1')).toBe(true);
  });

  it('returns false for current schemes', () => {
    expect(isLegacyScheme('whole')).toBe(false);
    expect(isLegacyScheme('framed')).toBe(false);
  });
});

describe('schemePipelinePosition', () => {
  it('whole and framed are pre-chunk', () => {
    expect(schemePipelinePosition('whole')).toBe('pre-chunk');
    expect(schemePipelinePosition('framed')).toBe('pre-chunk');
  });

  it('convergent is post-chunk', () => {
    expect(schemePipelinePosition('convergent')).toBe('post-chunk');
  });
});

describe('mapToCurrentScheme', () => {
  it.each([
    ['whole-v1', 'whole'],
    ['whole-v2', 'whole'],
    ['framed-v1', 'framed'],
    ['framed-v2', 'framed'],
    ['convergent-v1', 'convergent'],
  ])('maps "%s" → "%s"', (legacy, current) => {
    expect(mapToCurrentScheme(legacy)).toBe(current);
  });

  it('returns null for current schemes', () => {
    expect(mapToCurrentScheme('whole')).toBeNull();
    expect(mapToCurrentScheme('framed')).toBeNull();
    expect(mapToCurrentScheme('convergent')).toBeNull();
  });

  it('returns null for unknown schemes', () => {
    expect(mapToCurrentScheme('aes-cbc')).toBeNull();
  });
});

describe('isLegacyNoAad', () => {
  it('returns true for v1 schemes', () => {
    expect(isLegacyNoAad('whole-v1')).toBe(true);
    expect(isLegacyNoAad('framed-v1')).toBe(true);
    expect(isLegacyNoAad('convergent-v1')).toBe(true);
  });

  it('returns false for v2 schemes', () => {
    expect(isLegacyNoAad('whole-v2')).toBe(false);
    expect(isLegacyNoAad('framed-v2')).toBe(false);
  });

  it('returns false for current schemes', () => {
    expect(isLegacyNoAad('whole')).toBe(false);
  });
});
