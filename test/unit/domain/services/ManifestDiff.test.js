import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import diffManifests from '../../../../src/domain/services/ManifestDiff.js';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const sha1 = (s) => createHash('sha1').update(s).digest('hex');

function chunk(index, seed) {
  return { index, size: 1024, digest: sha256(seed), blob: sha1(seed) };
}

function manifest(chunks) {
  return new Manifest({
    slug: 'test', filename: 'test.bin',
    size: chunks.reduce((a, c) => a + c.size, 0),
    chunks,
  });
}

// ---------------------------------------------------------------------------
// Identical manifests
// ---------------------------------------------------------------------------
describe('diffManifests – identical', () => {
  it('returns all unchanged when manifests are identical', () => {
    const m = manifest([chunk(0, 'a'), chunk(1, 'b')]);
    const diff = diffManifests(m, m);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(2);
    expect(diff.summary.unchangedCount).toBe(2);
    expect(diff.summary.unchangedBytes).toBe(2048);
  });
});

// ---------------------------------------------------------------------------
// Completely different
// ---------------------------------------------------------------------------
describe('diffManifests – completely different', () => {
  it('returns all added and all removed', () => {
    const old = manifest([chunk(0, 'a'), chunk(1, 'b')]);
    const now = manifest([chunk(0, 'x'), chunk(1, 'y')]);
    const diff = diffManifests(old, now);
    expect(diff.added).toHaveLength(2);
    expect(diff.removed).toHaveLength(2);
    expect(diff.unchanged).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Partial overlap
// ---------------------------------------------------------------------------
describe('diffManifests – partial overlap', () => {
  it('identifies added, removed, and unchanged chunks', () => {
    const old = manifest([chunk(0, 'a'), chunk(1, 'b'), chunk(2, 'c')]);
    const now = manifest([chunk(0, 'a'), chunk(1, 'd'), chunk(2, 'c')]);
    const diff = diffManifests(old, now);

    expect(diff.unchanged).toHaveLength(2);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].digest).toBe(sha256('d'));
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].digest).toBe(sha256('b'));
  });
});

// ---------------------------------------------------------------------------
// Empty manifests
// ---------------------------------------------------------------------------
describe('diffManifests – empty manifests', () => {
  it('handles old empty', () => {
    const old = manifest([]);
    const now = manifest([chunk(0, 'a')]);
    const diff = diffManifests(old, now);
    expect(diff.added).toHaveLength(1);
    expect(diff.removed).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
  });

  it('handles new empty', () => {
    const old = manifest([chunk(0, 'a')]);
    const now = manifest([]);
    const diff = diffManifests(old, now);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(1);
    expect(diff.unchanged).toHaveLength(0);
  });

  it('handles both empty', () => {
    const diff = diffManifests(manifest([]), manifest([]));
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
    expect(diff.summary.addedBytes).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Summary stats
// ---------------------------------------------------------------------------
describe('diffManifests – summary', () => {
  it('computes correct byte counts', () => {
    const old = manifest([chunk(0, 'a'), chunk(1, 'b')]);
    const now = manifest([chunk(0, 'a'), chunk(1, 'c'), chunk(2, 'd')]);
    const diff = diffManifests(old, now);

    expect(diff.summary.addedCount).toBe(2);
    expect(diff.summary.addedBytes).toBe(2048);
    expect(diff.summary.removedCount).toBe(1);
    expect(diff.summary.removedBytes).toBe(1024);
    expect(diff.summary.unchangedCount).toBe(1);
    expect(diff.summary.unchangedBytes).toBe(1024);
  });
});

// ---------------------------------------------------------------------------
// Duplicate digests within a manifest
// ---------------------------------------------------------------------------
describe('diffManifests – duplicate digests', () => {
  it('handles repeated chunks in new manifest', () => {
    const old = manifest([chunk(0, 'a')]);
    const now = manifest([chunk(0, 'a'), chunk(1, 'a')]);
    const diff = diffManifests(old, now);
    // Both new chunks match the old digest — both unchanged
    expect(diff.unchanged).toHaveLength(2);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });
});
