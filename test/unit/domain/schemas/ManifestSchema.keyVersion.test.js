import { describe, it, expect } from 'vitest';
import { RecipientSchema, EncryptionSchema, ManifestSchema } from '../../../../src/domain/schemas/ManifestSchema.js';

const base64Bytes = (size, fill) => Buffer.alloc(size, fill).toString('base64');

const validRecipient = (overrides = {}) => ({
  label: 'alice',
  wrappedDek: base64Bytes(32, 1),
  nonce: base64Bytes(12, 2),
  tag: base64Bytes(16, 3),
  ...overrides,
});

const baseEncryption = (overrides = {}) => ({
  scheme: 'whole-v1',
  algorithm: 'aes-256-gcm',
  nonce: base64Bytes(12, 4),
  tag: base64Bytes(16, 5),
  encrypted: true,
  ...overrides,
});

// ---------------------------------------------------------------------------
// RecipientSchema — keyVersion
// ---------------------------------------------------------------------------
describe('RecipientSchema — keyVersion', () => {
  it('accepts keyVersion: 0', () => {
    const result = RecipientSchema.safeParse(validRecipient({ keyVersion: 0 }));
    expect(result.success).toBe(true);
    expect(result.data.keyVersion).toBe(0);
  });

  it('accepts keyVersion: 5', () => {
    const result = RecipientSchema.safeParse(validRecipient({ keyVersion: 5 }));
    expect(result.success).toBe(true);
    expect(result.data.keyVersion).toBe(5);
  });

  it('rejects keyVersion: -1', () => {
    expect(RecipientSchema.safeParse(validRecipient({ keyVersion: -1 })).success).toBe(false);
  });

  it('rejects keyVersion: 1.5 (non-integer)', () => {
    expect(RecipientSchema.safeParse(validRecipient({ keyVersion: 1.5 })).success).toBe(false);
  });

  it('omitted keyVersion parses cleanly', () => {
    const result = RecipientSchema.safeParse(validRecipient());
    expect(result.success).toBe(true);
    expect(result.data.keyVersion).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// EncryptionSchema — keyVersion
// ---------------------------------------------------------------------------
describe('EncryptionSchema — keyVersion', () => {
  it('accepts keyVersion: 0', () => {
    const result = EncryptionSchema.safeParse(baseEncryption({ keyVersion: 0 }));
    expect(result.success).toBe(true);
    expect(result.data.keyVersion).toBe(0);
  });

  it('accepts keyVersion: 5', () => {
    const result = EncryptionSchema.safeParse(baseEncryption({ keyVersion: 5 }));
    expect(result.success).toBe(true);
    expect(result.data.keyVersion).toBe(5);
  });

  it('rejects keyVersion: -1', () => {
    expect(EncryptionSchema.safeParse(baseEncryption({ keyVersion: -1 })).success).toBe(false);
  });

  it('rejects keyVersion: 1.5 (non-integer)', () => {
    expect(EncryptionSchema.safeParse(baseEncryption({ keyVersion: 1.5 })).success).toBe(false);
  });

  it('omitted keyVersion parses cleanly', () => {
    const result = EncryptionSchema.safeParse(baseEncryption());
    expect(result.success).toBe(true);
    expect(result.data.keyVersion).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ManifestSchema — full round-trip with keyVersion on both levels
// ---------------------------------------------------------------------------
describe('ManifestSchema — keyVersion round-trip', () => {
  it('round-trips keyVersion on both encryption and recipient levels', () => {
    const manifest = {
      version: 1,
      slug: 'rotation-test',
      filename: 'secret.bin',
      size: 1024,
      chunks: [{ index: 0, size: 1024, digest: 'a'.repeat(64), blob: 'b'.repeat(40) }],
      encryption: {
        ...baseEncryption({ keyVersion: 3 }),
        recipients: [
          validRecipient({ keyVersion: 2 }),
          validRecipient({ label: 'bob', keyVersion: 3 }),
        ],
      },
    };

    const result = ManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
    expect(result.data.encryption.keyVersion).toBe(3);
    expect(result.data.encryption.recipients[0].keyVersion).toBe(2);
    expect(result.data.encryption.recipients[1].keyVersion).toBe(3);
  });

  it('accepts framed-v1 keyVersion without whole-object nonce/tag fields', () => {
    const manifest = {
      version: 1,
      slug: 'framed-test',
      filename: 'secret.bin',
      size: 1024,
      chunks: [{ index: 0, size: 1024, digest: 'a'.repeat(64), blob: 'b'.repeat(40) }],
      encryption: {
        scheme: 'framed-v1',
        algorithm: 'aes-256-gcm',
        encrypted: true,
        frameBytes: 32768,
        keyVersion: 4,
      },
    };

    const result = ManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
    expect(result.data.encryption.keyVersion).toBe(4);
  });
});
