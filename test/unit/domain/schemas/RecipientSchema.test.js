import { describe, it, expect } from 'vitest';
import { RecipientSchema, EncryptionSchema } from '../../../../src/domain/schemas/ManifestSchema.js';

const base64Bytes = (size, fill) => Buffer.alloc(size, fill).toString('base64');

const validRecipient = () => ({
  label: 'alice',
  wrappedDek: base64Bytes(32, 1),
  nonce: base64Bytes(12, 2),
  tag: base64Bytes(16, 3),
});

// ---------------------------------------------------------------------------
// RecipientSchema — happy path
// ---------------------------------------------------------------------------
describe('RecipientSchema — happy path', () => {
  it('accepts a valid recipient entry', () => {
    expect(RecipientSchema.safeParse(validRecipient()).success).toBe(true);
  });

  it('accepts optional kekType', () => {
    const result = RecipientSchema.safeParse({ ...validRecipient(), kekType: 'raw' });
    expect(result.success).toBe(true);
    expect(result.data.kekType).toBe('raw');
  });
});

// ---------------------------------------------------------------------------
// RecipientSchema — rejections
// ---------------------------------------------------------------------------
describe('RecipientSchema — rejections', () => {
  it.each(['label', 'wrappedDek', 'nonce', 'tag'])('rejects missing %s', (field) => {
    const data = validRecipient();
    delete data[field];
    expect(RecipientSchema.safeParse(data).success).toBe(false);
  });

  it.each(['label', 'wrappedDek', 'nonce', 'tag'])('rejects empty %s', (field) => {
    expect(RecipientSchema.safeParse({ ...validRecipient(), [field]: '' }).success).toBe(false);
  });

  it('rejects malformed wrappedDek base64', () => {
    expect(RecipientSchema.safeParse({ ...validRecipient(), wrappedDek: '!not-base64!' }).success).toBe(false);
  });

  it('rejects wrong nonce byte length', () => {
    expect(RecipientSchema.safeParse({ ...validRecipient(), nonce: base64Bytes(11, 9) }).success).toBe(false);
  });

  it('rejects wrong tag byte length', () => {
    expect(RecipientSchema.safeParse({ ...validRecipient(), tag: base64Bytes(15, 9) }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EncryptionSchema — recipients integration
// ---------------------------------------------------------------------------
describe('EncryptionSchema — recipients', () => { // eslint-disable-line max-lines-per-function
  const baseEncryption = () => ({
    scheme: 'whole-v1',
    algorithm: 'aes-256-gcm',
    nonce: base64Bytes(12, 4),
    tag: base64Bytes(16, 5),
    encrypted: true,
  });

  it('backward compat: legacy whole-v1 without scheme is valid', () => {
    const result = EncryptionSchema.safeParse({
      algorithm: 'aes-256-gcm',
      nonce: base64Bytes(12, 4),
      tag: base64Bytes(16, 5),
      encrypted: true,
    });
    expect(result.success).toBe(true);
    expect(result.data.recipients).toBeUndefined();
  });

  it('accepts explicit whole-v1 metadata', () => {
    const result = EncryptionSchema.safeParse(baseEncryption());
    expect(result.success).toBe(true);
    expect(result.data.scheme).toBe('whole-v1');
  });

  it('accepts framed-v1 metadata with frameBytes and no nonce/tag', () => {
    const result = EncryptionSchema.safeParse({
      scheme: 'framed-v1',
      algorithm: 'aes-256-gcm',
      encrypted: true,
      frameBytes: 65536,
    });
    expect(result.success).toBe(true);
    expect(result.data.frameBytes).toBe(65536);
  });

  it('accepts valid recipients array', () => {
    const data = { ...baseEncryption(), recipients: [validRecipient()] };
    const result = EncryptionSchema.safeParse(data);
    expect(result.success).toBe(true);
    expect(result.data.recipients).toHaveLength(1);
  });

  it('accepts multiple recipients', () => {
    const data = {
      ...baseEncryption(),
      recipients: [
        { ...validRecipient(), label: 'alice' },
        { ...validRecipient(), label: 'bob' },
      ],
    };
    const result = EncryptionSchema.safeParse(data);
    expect(result.success).toBe(true);
    expect(result.data.recipients).toHaveLength(2);
  });

  it('rejects empty recipients array', () => {
    const data = { ...baseEncryption(), recipients: [] };
    expect(EncryptionSchema.safeParse(data).success).toBe(false);
  });

  it('rejects recipients with invalid entry', () => {
    const data = { ...baseEncryption(), recipients: [{ label: '' }] };
    expect(EncryptionSchema.safeParse(data).success).toBe(false);
  });

  it('rejects encrypted:false because encryption metadata must describe encrypted content', () => {
    expect(EncryptionSchema.safeParse({ ...baseEncryption(), encrypted: false }).success).toBe(false);
  });

  it('rejects unsupported algorithms', () => {
    expect(EncryptionSchema.safeParse({ ...baseEncryption(), algorithm: 'aes-128-cbc' }).success).toBe(false);
  });

  it('rejects wrong whole-v1 nonce byte length', () => {
    expect(EncryptionSchema.safeParse({ ...baseEncryption(), nonce: base64Bytes(11, 6) }).success).toBe(false);
  });

  it('rejects wrong whole-v1 tag byte length', () => {
    expect(EncryptionSchema.safeParse({ ...baseEncryption(), tag: base64Bytes(15, 7) }).success).toBe(false);
  });

  it('rejects framed-v1 without frameBytes', () => {
    expect(EncryptionSchema.safeParse({
      scheme: 'framed-v1',
      algorithm: 'aes-256-gcm',
      encrypted: true,
    }).success).toBe(false);
  });

  it('rejects framed-v1 when manifest-level nonce/tag are present', () => {
    expect(EncryptionSchema.safeParse({
      scheme: 'framed-v1',
      algorithm: 'aes-256-gcm',
      encrypted: true,
      frameBytes: 128,
      nonce: base64Bytes(12, 8),
      tag: base64Bytes(16, 9),
    }).success).toBe(false);
  });

  it('rejects unknown encryption schemes', () => {
    expect(EncryptionSchema.safeParse({
      scheme: 'future-v99',
      algorithm: 'aes-256-gcm',
      encrypted: true,
      nonce: base64Bytes(12, 4),
      tag: base64Bytes(16, 5),
    }).success).toBe(false);
  });
});
