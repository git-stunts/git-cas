import { describe, it, expect } from 'vitest';
import { RecipientSchema, EncryptionSchema } from '../../../../src/domain/schemas/ManifestSchema.js';

const validRecipient = () => ({
  label: 'alice',
  wrappedDek: 'AAAA',
  nonce: 'BBBB',
  tag: 'CCCC',
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
});

// ---------------------------------------------------------------------------
// EncryptionSchema — recipients integration
// ---------------------------------------------------------------------------
describe('EncryptionSchema — recipients', () => {
  const baseEncryption = () => ({
    algorithm: 'aes-256-gcm',
    nonce: 'bm9uY2U=',
    tag: 'dGFn',
    encrypted: true,
  });

  it('backward compat: no recipients field → valid', () => {
    const result = EncryptionSchema.safeParse(baseEncryption());
    expect(result.success).toBe(true);
    expect(result.data.recipients).toBeUndefined();
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
});
