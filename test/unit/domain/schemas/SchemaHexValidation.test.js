import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { ChunkSchema, SubManifestRefSchema } from '../../../../src/domain/schemas/ManifestSchema.js';

const sha256 = (str) => createHash('sha256').update(str).digest('hex');
const sha1 = (str) => createHash('sha1').update(str).digest('hex');

// ---------------------------------------------------------------------------
// ChunkSchema – digest must be lowercase hex
// ---------------------------------------------------------------------------
describe('ChunkSchema – digest hex validation', () => {
  const validChunk = () => ({
    index: 0,
    size: 256,
    blob: sha1('blob-content'),
    digest: sha256('chunk-content'),
  });

  it('accepts a valid 64-char lowercase hex digest', () => {
    expect(() => ChunkSchema.parse(validChunk())).not.toThrow();
  });

  it('rejects a digest with non-hex characters', () => {
    const data = { ...validChunk(), digest: 'g'.repeat(64) };
    expect(() => ChunkSchema.parse(data)).toThrow();
  });

  it('rejects a digest with uppercase hex', () => {
    const data = { ...validChunk(), digest: sha256('test').toUpperCase() };
    expect(() => ChunkSchema.parse(data)).toThrow();
  });

  it('rejects a digest with spaces', () => {
    const data = { ...validChunk(), digest: ' '.repeat(64) };
    expect(() => ChunkSchema.parse(data)).toThrow();
  });

  it('rejects a digest containing tab characters', () => {
    const data = { ...validChunk(), digest: `${'a'.repeat(63)}\t` };
    expect(() => ChunkSchema.parse(data)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ChunkSchema – blob must be lowercase hex OID (40 or 64 chars)
// ---------------------------------------------------------------------------
describe('ChunkSchema – blob hex OID validation', () => {
  const validChunk = (blob) => ({
    index: 0,
    size: 256,
    blob,
    digest: sha256('chunk-content'),
  });

  it('accepts a 40-char SHA-1 hex OID', () => {
    expect(() => ChunkSchema.parse(validChunk(sha1('test')))).not.toThrow();
  });

  it('accepts a 64-char SHA-256 hex OID', () => {
    expect(() => ChunkSchema.parse(validChunk(sha256('test')))).not.toThrow();
  });

  it('rejects a non-hex blob string', () => {
    expect(() => ChunkSchema.parse(validChunk('blob-oid-0'))).toThrow();
  });

  it('rejects a blob with arbitrary length', () => {
    expect(() => ChunkSchema.parse(validChunk('abcdef'))).toThrow();
  });

  it('rejects a blob containing newline (mktree injection)', () => {
    expect(() => ChunkSchema.parse(validChunk(`${'a'.repeat(39)}\n`))).toThrow();
  });

  it('rejects a blob containing tab (mktree injection)', () => {
    expect(() => ChunkSchema.parse(validChunk(`${'a'.repeat(39)}\t`))).toThrow();
  });

  it('rejects a blob with --batch flag injection attempt', () => {
    expect(() => ChunkSchema.parse(validChunk('--batch'))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SubManifestRefSchema – oid must be lowercase hex OID
// ---------------------------------------------------------------------------
describe('SubManifestRefSchema – oid hex validation', () => {
  const validRef = (oid) => ({
    oid,
    chunkCount: 5,
    startIndex: 0,
  });

  it('accepts a 40-char SHA-1 hex OID', () => {
    expect(() => SubManifestRefSchema.parse(validRef(sha1('test')))).not.toThrow();
  });

  it('accepts a 64-char SHA-256 hex OID', () => {
    expect(() => SubManifestRefSchema.parse(validRef(sha256('test')))).not.toThrow();
  });

  it('rejects a non-hex oid string', () => {
    expect(() => SubManifestRefSchema.parse(validRef('abc123'))).toThrow();
  });

  it('rejects an oid with spaces', () => {
    expect(() => SubManifestRefSchema.parse(validRef(`${'a'.repeat(39)} `))).toThrow();
  });
});
