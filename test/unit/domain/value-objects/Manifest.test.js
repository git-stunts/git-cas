import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';

/** Deterministic SHA-256 hex digest for a given string. */
const sha256 = (str) => createHash('sha256').update(str).digest('hex');

/** Reusable valid chunk entry. */
const validChunk = (index = 0) => ({
  index,
  size: 128,
  blob: 'abc123',
  digest: sha256(`chunk-${index}`),
});

/** Reusable minimal valid manifest data. */
const validManifestData = () => ({
  slug: 'my-slug',
  filename: 'photo.jpg',
  size: 128,
  chunks: [validChunk(0)],
});

describe('Manifest value-object', () => {
  // ─── happy path ─────────────────────────────────────────────────────

  it('creates a frozen object from valid data', () => {
    const m = new Manifest(validManifestData());

    expect(m.slug).toBe('my-slug');
    expect(m.filename).toBe('photo.jpg');
    expect(m.size).toBe(128);
    expect(m.chunks).toHaveLength(1);
    expect(Object.isFrozen(m)).toBe(true);
  });

  it('includes encryption metadata when provided', () => {
    const data = {
      ...validManifestData(),
      encryption: {
        algorithm: 'aes-256-gcm',
        nonce: 'bm9uY2U=',
        tag: 'dGFn',
        encrypted: true,
      },
    };
    const m = new Manifest(data);
    expect(m.encryption).toEqual(data.encryption);
  });

  it('toJSON round-trips without loss', () => {
    const data = validManifestData();
    const m = new Manifest(data);
    const json = m.toJSON();
    expect(json.slug).toBe(data.slug);
    expect(json.filename).toBe(data.filename);
    expect(json.size).toBe(data.size);
    expect(json.chunks).toHaveLength(data.chunks.length);
  });

  // ─── missing / invalid slug ─────────────────────────────────────────

  it('throws when slug is missing', () => {
    const data = validManifestData();
    delete data.slug;
    expect(() => new Manifest(data)).toThrow(/[Ii]nvalid manifest data/);
  });

  it('throws when slug is empty string', () => {
    const data = { ...validManifestData(), slug: '' };
    expect(() => new Manifest(data)).toThrow(/[Ii]nvalid manifest data/);
  });

  // ─── missing / invalid filename ─────────────────────────────────────

  it('throws when filename is missing', () => {
    const data = validManifestData();
    delete data.filename;
    expect(() => new Manifest(data)).toThrow(/[Ii]nvalid manifest data/);
  });

  // ─── size validation ────────────────────────────────────────────────

  it('throws when size is negative', () => {
    const data = { ...validManifestData(), size: -1 };
    expect(() => new Manifest(data)).toThrow(/[Ii]nvalid manifest data/);
  });

  it('allows size of zero', () => {
    const data = { ...validManifestData(), size: 0, chunks: [] };
    const m = new Manifest(data);
    expect(m.size).toBe(0);
  });

  // ─── chunks validation ──────────────────────────────────────────────

  it('throws when chunks is not an array', () => {
    const data = { ...validManifestData(), chunks: 'not-an-array' };
    expect(() => new Manifest(data)).toThrow(/[Ii]nvalid manifest data/);
  });

  it('throws when chunks is null', () => {
    const data = { ...validManifestData(), chunks: null };
    expect(() => new Manifest(data)).toThrow();
  });

  // ─── missing required fields ────────────────────────────────────────

  it('throws when size field is missing entirely', () => {
    const data = validManifestData();
    delete data.size;
    expect(() => new Manifest(data)).toThrow(/[Ii]nvalid manifest data/);
  });

  it('throws when chunks field is missing entirely', () => {
    const data = validManifestData();
    delete data.chunks;
    expect(() => new Manifest(data)).toThrow();
  });
});
