import { describe, it, expect } from 'vitest';
import {
  isLegacyScheme, mapToCurrentScheme, isLegacyNoAad,
} from '../../../../src/domain/encryption/schemes.js';

// ---------------------------------------------------------------------------
// Migration classification — documents semantics used by
// scripts/migrate-encryption.js classifyEntry()
// ---------------------------------------------------------------------------

describe('migration classification: isLegacyNoAad semantics', () => {
  it('convergent-v1 returns true from isLegacyNoAad', () => {
    // convergent-v1 returns true because it IS a v1 scheme that had no AAD.
    // However, convergent encryption never used AAD binding at all (keys are
    // derived per-chunk from content), so it should be classified as a FAST
    // migration (rename-only) rather than a FULL migration (re-encrypt).
    //
    // The migration script's classifyEntry() must override this: even though
    // isLegacyNoAad('convergent-v1') === true, convergent-v1 entries need
    // only a scheme rename, not re-encryption.
    expect(isLegacyNoAad('convergent-v1')).toBe(true);
  });

  it('whole-v1 and framed-v1 return true (these DO need re-encryption)', () => {
    expect(isLegacyNoAad('whole-v1')).toBe(true);
    expect(isLegacyNoAad('framed-v1')).toBe(true);
  });

  it('v2 schemes return false (already had AAD)', () => {
    expect(isLegacyNoAad('whole-v2')).toBe(false);
    expect(isLegacyNoAad('framed-v2')).toBe(false);
  });

  it('current schemes return false', () => {
    expect(isLegacyNoAad('whole')).toBe(false);
    expect(isLegacyNoAad('framed')).toBe(false);
    expect(isLegacyNoAad('convergent')).toBe(false);
  });
});

describe('migration classification: mapToCurrentScheme covers all 5 legacy schemes', () => {
  it.each([
    ['whole-v1', 'whole'],
    ['whole-v2', 'whole'],
    ['framed-v1', 'framed'],
    ['framed-v2', 'framed'],
    ['convergent-v1', 'convergent'],
  ])('maps "%s" -> "%s"', (legacy, current) => {
    expect(mapToCurrentScheme(legacy)).toBe(current);
  });

  it('returns null for unrecognized schemes', () => {
    expect(mapToCurrentScheme('chacha20')).toBeNull();
    expect(mapToCurrentScheme('')).toBeNull();
  });
});

describe('migration classification: current schemes are not legacy', () => {
  it.each([
    'whole', 'framed', 'convergent',
  ])('isLegacyScheme("%s") returns false', (scheme) => {
    expect(isLegacyScheme(scheme)).toBe(false);
  });

  it.each([
    'whole-v1', 'whole-v2', 'framed-v1', 'framed-v2', 'convergent-v1',
  ])('isLegacyScheme("%s") returns true', (scheme) => {
    expect(isLegacyScheme(scheme)).toBe(true);
  });
});
