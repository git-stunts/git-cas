import { describe, expect, it } from 'vitest';
import { resolveVersionString } from '../../../bin/build-version.js';

describe('CLI build version', () => {
  it('prefers the live git SHA over a stamped package SHA', () => {
    const version = resolveVersionString('6.0.0', {
      readGitSha: () => 'live123',
      readStampedSha: () => 'stale456',
    });

    expect(version).toBe('6.0.0+live123');
  });

  it('uses the stamped package SHA when live git is unavailable', () => {
    const version = resolveVersionString('6.0.0', {
      readGitSha: () => null,
      readStampedSha: () => 'pack123',
    });

    expect(version).toBe('6.0.0+pack123');
  });

  it('falls back to semver when no SHA source is available', () => {
    const version = resolveVersionString('6.0.0', {
      readGitSha: () => null,
      readStampedSha: () => null,
    });

    expect(version).toBe('6.0.0');
  });

  it('falls back to semver when the stamped SHA is the unknown sentinel', () => {
    const version = resolveVersionString('6.0.0', {
      readGitSha: () => null,
      readStampedSha: () => 'unknown',
    });

    expect(version).toBe('6.0.0');
  });
});
