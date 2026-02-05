import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import Chunk from '../../../../src/domain/value-objects/Chunk.js';

/** Deterministic SHA-256 hex digest (always 64 hex chars). */
const sha256 = (str) => createHash('sha256').update(str).digest('hex');

/** Reusable minimal valid chunk data. */
const validChunkData = () => ({
  index: 0,
  size: 256,
  blob: 'abc123',
  digest: sha256('test-chunk-0'),
});

// ---------------------------------------------------------------------------
// Creation (happy path)
// ---------------------------------------------------------------------------
describe('Chunk – creation', () => {
  it('creates a frozen object from valid data', () => {
    const c = new Chunk(validChunkData());

    expect(c.index).toBe(0);
    expect(c.size).toBe(256);
    expect(c.blob).toBe('abc123');
    expect(c.digest).toBe(sha256('test-chunk-0'));
    expect(Object.isFrozen(c)).toBe(true);
  });

  it('accepts index of zero', () => {
    const c = new Chunk({ ...validChunkData(), index: 0 });
    expect(c.index).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Field validation
// ---------------------------------------------------------------------------
describe('Chunk – field validation', () => {
  it('throws when index is negative', () => {
    const data = { ...validChunkData(), index: -1 };
    expect(() => new Chunk(data)).toThrow(/[Ii]nvalid chunk data/);
  });

  it('throws when index is a float', () => {
    const data = { ...validChunkData(), index: 1.5 };
    expect(() => new Chunk(data)).toThrow(/[Ii]nvalid chunk data/);
  });

  it('throws when size is 0 (schema requires positive)', () => {
    const data = { ...validChunkData(), size: 0 };
    expect(() => new Chunk(data)).toThrow(/[Ii]nvalid chunk data/);
  });

  it('throws when size is negative', () => {
    const data = { ...validChunkData(), size: -100 };
    expect(() => new Chunk(data)).toThrow(/[Ii]nvalid chunk data/);
  });

  it('throws when digest is 63 characters', () => {
    const data = { ...validChunkData(), digest: 'a'.repeat(63) };
    expect(() => new Chunk(data)).toThrow(/[Ii]nvalid chunk data/);
  });

  it('throws when digest is 65 characters', () => {
    const data = { ...validChunkData(), digest: 'a'.repeat(65) };
    expect(() => new Chunk(data)).toThrow(/[Ii]nvalid chunk data/);
  });

  it('throws when digest is empty string', () => {
    const data = { ...validChunkData(), digest: '' };
    expect(() => new Chunk(data)).toThrow(/[Ii]nvalid chunk data/);
  });

  it('throws when blob is empty string', () => {
    const data = { ...validChunkData(), blob: '' };
    expect(() => new Chunk(data)).toThrow(/[Ii]nvalid chunk data/);
  });
});

// ---------------------------------------------------------------------------
// Missing fields
// ---------------------------------------------------------------------------
describe('Chunk – missing fields', () => {
  it('throws when index is missing', () => {
    const data = validChunkData();
    delete data.index;
    expect(() => new Chunk(data)).toThrow(/[Ii]nvalid chunk data/);
  });

  it('throws when size is missing', () => {
    const data = validChunkData();
    delete data.size;
    expect(() => new Chunk(data)).toThrow(/[Ii]nvalid chunk data/);
  });

  it('throws when digest is missing', () => {
    const data = validChunkData();
    delete data.digest;
    expect(() => new Chunk(data)).toThrow(/[Ii]nvalid chunk data/);
  });

  it('throws when blob is missing', () => {
    const data = validChunkData();
    delete data.blob;
    expect(() => new Chunk(data)).toThrow(/[Ii]nvalid chunk data/);
  });

  it('throws when constructed with no arguments', () => {
    expect(() => new Chunk()).toThrow();
  });
});
