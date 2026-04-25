import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';

const base64Bytes = (size, fill) => Buffer.alloc(size, fill).toString('base64');

/** Deterministic SHA-256 hex digest for a given string. */
const sha256 = (str) => createHash('sha256').update(str).digest('hex');

/** Valid 40-char hex OID for blob fields. */
const VALID_BLOB = 'a'.repeat(40);

/** Reusable valid chunk entry. */
const validChunk = (index = 0) => ({
  index,
  size: 128,
  blob: VALID_BLOB,
  digest: sha256(`chunk-${index}`),
});

/** Reusable minimal valid manifest data. */
const validManifestData = () => ({
  slug: 'my-slug',
  filename: 'photo.jpg',
  size: 128,
  chunks: [validChunk(0)],
});

// ---------------------------------------------------------------------------
// Creation (happy path + toJSON)
// ---------------------------------------------------------------------------
describe('Manifest – creation', () => { // eslint-disable-line max-lines-per-function
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
        scheme: 'whole',
        algorithm: 'aes-256-gcm',
        nonce: base64Bytes(12, 1),
        tag: base64Bytes(16, 2),
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

  it('creates a manifest with framed encryption metadata', () => {
    const data = {
      ...validManifestData(),
      encryption: {
        scheme: 'framed',
        algorithm: 'aes-256-gcm',
        encrypted: true,
        frameBytes: 32768,
      },
    };

    const manifest = new Manifest(data);
    expect(manifest.encryption.scheme).toBe('framed');
    expect(manifest.encryption.frameBytes).toBe(32768);
    expect(manifest.encryption.nonce).toBeUndefined();
    expect(manifest.encryption.tag).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Validation – slug and filename
// ---------------------------------------------------------------------------
describe('Manifest – validation (slug and filename)', () => {
  it('throws when slug is missing', () => {
    const data = validManifestData();
    delete data.slug;
    expect(() => new Manifest(data)).toThrow(/[Ii]nvalid manifest data/);
  });

  it('throws when slug is empty string', () => {
    const data = { ...validManifestData(), slug: '' };
    expect(() => new Manifest(data)).toThrow(/[Ii]nvalid manifest data/);
  });

  it('throws when filename is missing', () => {
    const data = validManifestData();
    delete data.filename;
    expect(() => new Manifest(data)).toThrow(/[Ii]nvalid manifest data/);
  });
});

// ---------------------------------------------------------------------------
// Validation – size and chunks
// ---------------------------------------------------------------------------
describe('Manifest – validation (size and chunks)', () => {
  it('throws when size is negative', () => {
    const data = { ...validManifestData(), size: -1 };
    expect(() => new Manifest(data)).toThrow(/[Ii]nvalid manifest data/);
  });

  it('allows size of zero', () => {
    const data = { ...validManifestData(), size: 0, chunks: [] };
    const m = new Manifest(data);
    expect(m.size).toBe(0);
  });

  it('throws when chunks is not an array', () => {
    const data = { ...validManifestData(), chunks: 'not-an-array' };
    expect(() => new Manifest(data)).toThrow(/[Ii]nvalid manifest data/);
  });

  it('throws when chunks is null', () => {
    const data = { ...validManifestData(), chunks: null };
    expect(() => new Manifest(data)).toThrow();
  });

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

// ---------------------------------------------------------------------------
// Backward compatibility – chunking field
// ---------------------------------------------------------------------------
describe('Manifest – backward compatibility (chunking)', () => { // eslint-disable-line max-lines-per-function
  it('v1 manifest without chunking field is valid', () => {
    const data = { ...validManifestData(), version: 1 };
    const m = new Manifest(data);
    expect(m.version).toBe(1);
    expect(m.chunking).toBeUndefined();
  });

  it('v2 manifest without chunking field is valid', () => {
    const data = { ...validManifestData(), version: 2 };
    const m = new Manifest(data);
    expect(m.version).toBe(2);
    expect(m.chunking).toBeUndefined();
  });

  it('v1 manifest WITH chunking field is valid', () => {
    const data = {
      ...validManifestData(),
      version: 1,
      chunking: { strategy: 'fixed', params: { chunkSize: 262144 } },
    };
    const m = new Manifest(data);
    expect(m.chunking).toEqual(data.chunking);
  });

  it('v2 manifest with subManifests and chunking is valid', () => {
    const data = {
      ...validManifestData(),
      version: 2,
      chunking: { strategy: 'cdc', params: { target: 262144, min: 65536, max: 1048576 } },
      subManifests: [{ oid: 'b'.repeat(40), chunkCount: 5, startIndex: 0 }],
    };
    const m = new Manifest(data);
    expect(m.chunking.strategy).toBe('cdc');
    expect(m.subManifests).toHaveLength(1);
  });

  it('manifest with encryption + compression + chunking is valid', () => {
    const data = {
      ...validManifestData(),
      encryption: {
        scheme: 'whole',
        algorithm: 'aes-256-gcm',
        nonce: base64Bytes(12, 3),
        tag: base64Bytes(16, 4),
        encrypted: true,
      },
      compression: { algorithm: 'gzip' },
      chunking: { strategy: 'fixed', params: { chunkSize: 131072 } },
    };
    const m = new Manifest(data);
    expect(m.encryption.algorithm).toBe('aes-256-gcm');
    expect(m.compression.algorithm).toBe('gzip');
    expect(m.chunking.strategy).toBe('fixed');
  });
});

// ---------------------------------------------------------------------------
// Recipients field – creation and serialization
// ---------------------------------------------------------------------------
describe('Manifest – recipients (creation)', () => { // eslint-disable-line max-lines-per-function
  it('validates manifest with recipients in encryption', () => {
    const data = {
      ...validManifestData(),
      encryption: {
        scheme: 'whole',
        algorithm: 'aes-256-gcm',
        nonce: base64Bytes(12, 5),
        tag: base64Bytes(16, 6),
        encrypted: true,
        recipients: [{ label: 'alice', wrappedDek: base64Bytes(32, 7), nonce: base64Bytes(12, 8), tag: base64Bytes(16, 9) }],
      },
    };
    const m = new Manifest(data);
    expect(m.encryption.recipients).toHaveLength(1);
    expect(m.encryption.recipients[0].label).toBe('alice');
  });

  it('toJSON includes recipients when present', () => {
    const data = {
      ...validManifestData(),
      encryption: {
        scheme: 'whole', algorithm: 'aes-256-gcm', nonce: base64Bytes(12, 5), tag: base64Bytes(16, 6), encrypted: true,
        recipients: [
          { label: 'alice', wrappedDek: base64Bytes(32, 7), nonce: base64Bytes(12, 8), tag: base64Bytes(16, 9) },
          { label: 'bob', wrappedDek: base64Bytes(32, 10), nonce: base64Bytes(12, 11), tag: base64Bytes(16, 12) },
        ],
      },
    };
    const json = new Manifest(data).toJSON();
    expect(json.encryption.recipients).toHaveLength(2);
    expect(json.encryption.recipients[0].label).toBe('alice');
  });

  it('allows encryption without recipients', () => {
    const data = {
      ...validManifestData(),
      encryption: { scheme: 'whole', algorithm: 'aes-256-gcm', nonce: base64Bytes(12, 5), tag: base64Bytes(16, 6), encrypted: true },
    };
    expect(new Manifest(data).encryption.recipients).toBeUndefined();
  });

  it('throws on malformed whole encryption metadata at construction time', () => {
    const data = {
      ...validManifestData(),
      encryption: {
        scheme: 'whole',
        algorithm: 'aes-256-gcm',
        nonce: 'not-valid-base64',
        tag: base64Bytes(16, 6),
        encrypted: true,
      },
    };

    expect(() => new Manifest(data)).toThrow(/Invalid manifest data/);
  });

  it('throws on malformed KDF salt metadata at construction time', () => {
    const data = {
      ...validManifestData(),
      encryption: {
        scheme: 'whole',
        algorithm: 'aes-256-gcm',
        nonce: base64Bytes(12, 5),
        tag: base64Bytes(16, 6),
        encrypted: true,
        kdf: {
          algorithm: 'pbkdf2',
          salt: '%%%bad-base64%%%',
          iterations: 600000,
          keyLength: 32,
        },
      },
    };

    expect(() => new Manifest(data)).toThrow(/Invalid manifest data/);
  });
});

// ---------------------------------------------------------------------------
// Recipients field – deep-copy isolation
// ---------------------------------------------------------------------------
describe('Manifest – recipients (deep-copy)', () => {
  it('deep-copies recipients so source mutation does not affect manifest', () => {
    const recipients = [{ label: 'alice', wrappedDek: base64Bytes(32, 7), nonce: base64Bytes(12, 8), tag: base64Bytes(16, 9) }];
    const data = {
      ...validManifestData(),
      encryption: {
        scheme: 'whole', algorithm: 'aes-256-gcm', nonce: base64Bytes(12, 5), tag: base64Bytes(16, 6), encrypted: true,
        recipients,
      },
    };
    const m = new Manifest(data);
    recipients[0].label = 'eve';
    expect(m.encryption.recipients[0].label).toBe('alice');
  });
});

// ---------------------------------------------------------------------------
// Chunking value object – access and freezing
// ---------------------------------------------------------------------------
describe('Manifest – chunking value object', () => {
  it('manifest created with chunking exposes accessible and frozen chunking', () => {
    const data = {
      ...validManifestData(),
      chunking: { strategy: 'fixed', params: { chunkSize: 262144 } },
    };
    const m = new Manifest(data);
    expect(m.chunking).toBeDefined();
    expect(m.chunking.strategy).toBe('fixed');
    expect(m.chunking.params.chunkSize).toBe(262144);
    expect(Object.isFrozen(m)).toBe(true);
  });

  it('manifest created without chunking has undefined chunking', () => {
    const m = new Manifest(validManifestData());
    expect(m.chunking).toBeUndefined();
  });

  it('toJSON includes chunking when present', () => {
    const data = {
      ...validManifestData(),
      chunking: { strategy: 'cdc', params: { target: 262144, min: 65536, max: 1048576 } },
    };
    const m = new Manifest(data);
    const json = m.toJSON();
    expect(json.chunking).toEqual(data.chunking);
  });

  it('toJSON omits chunking when absent (undefined)', () => {
    const m = new Manifest(validManifestData());
    const json = m.toJSON();
    expect(json.chunking).toBeUndefined();
  });
});
