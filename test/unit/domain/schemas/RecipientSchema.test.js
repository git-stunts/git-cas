import { describe, it, expect } from 'vitest';
import { RecipientSchema, EncryptionSchema } from '../../../../src/domain/schemas/ManifestSchema.js';

// ---------------------------------------------------------------------------
// RecipientSchema
// ---------------------------------------------------------------------------
describe('RecipientSchema', () => {
  const validRecipient = () => ({
    label: 'alice',
    wrappedDek: 'AAAA',
    nonce: 'BBBB',
    tag: 'CCCC',
  });

  it('accepts a valid recipient entry', () => {
    const result = RecipientSchema.safeParse(validRecipient());
    expect(result.success).toBe(true);
  });

  it('accepts optional kekType', () => {
    const result = RecipientSchema.safeParse({ ...validRecipient(), kekType: 'raw' });
    expect(result.success).toBe(true);
    expect(result.data.kekType).toBe('raw');
  });

  it('rejects missing label', () => {
    const { label, ...rest } = validRecipient();
    expect(RecipientSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects empty label', () => {
    expect(RecipientSchema.safeParse({ ...validRecipient(), label: '' }).success).toBe(false);
  });

  it('rejects missing wrappedDek', () => {
    const { wrappedDek, ...rest } = validRecipient();
    expect(RecipientSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects empty wrappedDek', () => {
    expect(RecipientSchema.safeParse({ ...validRecipient(), wrappedDek: '' }).success).toBe(false);
  });

  it('rejects missing nonce', () => {
    const { nonce, ...rest } = validRecipient();
    expect(RecipientSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects empty nonce', () => {
    expect(RecipientSchema.safeParse({ ...validRecipient(), nonce: '' }).success).toBe(false);
  });

  it('rejects missing tag', () => {
    const { tag, ...rest } = validRecipient();
    expect(RecipientSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects empty tag', () => {
    expect(RecipientSchema.safeParse({ ...validRecipient(), tag: '' }).success).toBe(false);
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

  const validRecipient = () => ({
    label: 'alice',
    wrappedDek: 'AAAA',
    nonce: 'BBBB',
    tag: 'CCCC',
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

  it('accepts empty recipients array', () => {
    const data = { ...baseEncryption(), recipients: [] };
    const result = EncryptionSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('rejects recipients with invalid entry', () => {
    const data = { ...baseEncryption(), recipients: [{ label: '' }] };
    const result = EncryptionSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});
