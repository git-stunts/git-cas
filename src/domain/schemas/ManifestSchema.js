/* @ts-self-types="./ManifestSchema.d.ts" */
/**
 * @fileoverview Zod schemas for validating CAS manifest and chunk data.
 */

import { Buffer } from 'node:buffer';
import z from 'zod';

const CANONICAL_BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isCanonicalBase64(value) {
  return CANONICAL_BASE64_RE.test(value) && Buffer.from(value, 'base64').toString('base64') === value;
}

function base64BytesSchema(field, byteLength) {
  return z.string()
    .min(1)
    .refine((value) => isCanonicalBase64(value), {
      message: `${field} must be canonical base64`,
    })
    .refine((value) => Buffer.from(value, 'base64').length === byteLength, {
      message: `${field} must decode to ${byteLength} bytes`,
    });
}

/** Validates a single chunk entry within a manifest. */
export const ChunkSchema = z.object({
  index: z.number().int().min(0),
  size: z.number().int().positive(),
  digest: z.string().length(64), // SHA-256
  blob: z.string().min(1),       // Git OID
});

/** Validates KDF parameters stored alongside encryption metadata. */
export const KdfSchema = z.object({
  algorithm: z.enum(['pbkdf2', 'scrypt']),
  salt: z.string().min(1),
  iterations: z.number().int().positive().optional(),
  cost: z.number().int().positive().optional(),
  blockSize: z.number().int().positive().optional(),
  parallelization: z.number().int().positive().optional(),
  keyLength: z.number().int().positive().default(32),
});

/** Validates a single recipient entry in an envelope-encrypted manifest. */
export const RecipientSchema = z.object({
  label: z.string().min(1),
  wrappedDek: base64BytesSchema('wrappedDek', 32),
  nonce: base64BytesSchema('nonce', 12),
  tag: base64BytesSchema('tag', 16),
  kekType: z.string().optional(),
  keyVersion: z.number().int().min(0).optional(),
});

/** Validates the encryption metadata attached to an encrypted manifest. */
const EncryptionBaseSchema = {
  algorithm: z.literal('aes-256-gcm'),
  encrypted: z.literal(true).default(true),
  kdf: KdfSchema.optional(),
  recipients: z.array(RecipientSchema).min(1).optional(),
  keyVersion: z.number().int().min(0).optional(),
};

const WholeEncryptionSchema = z.object({
  scheme: z.literal('whole-v1').optional(),
  ...EncryptionBaseSchema,
  nonce: base64BytesSchema('nonce', 12),
  tag: base64BytesSchema('tag', 16),
  frameBytes: z.undefined().optional(),
});

const FramedEncryptionSchema = z.object({
  scheme: z.literal('framed-v1'),
  ...EncryptionBaseSchema,
  frameBytes: z.number().int().positive(),
  nonce: z.undefined().optional(),
  tag: z.undefined().optional(),
});

export const EncryptionSchema = z.union([
  WholeEncryptionSchema,
  FramedEncryptionSchema,
]);

/** Validates compression metadata. */
export const CompressionSchema = z.object({
  algorithm: z.enum(['gzip']),
});

/** Validates fixed-size chunking parameters. */
export const FixedChunkingSchema = z.object({
  strategy: z.literal('fixed'),
  params: z.object({
    chunkSize: z.number().int().positive(),
  }),
});

/** Validates content-defined chunking (CDC) parameters. */
export const CdcChunkingSchema = z.object({
  strategy: z.literal('cdc'),
  params: z.object({
    target: z.number().int().positive(),
    min: z.number().int().positive(),
    max: z.number().int().positive(),
  }),
});

/** Validates chunking metadata (fixed or CDC). */
export const ChunkingSchema = z.discriminatedUnion('strategy', [
  FixedChunkingSchema,
  CdcChunkingSchema,
]);

/** Validates a sub-manifest reference in a v2 Merkle manifest. */
export const SubManifestRefSchema = z.object({
  oid: z.string().min(1),
  chunkCount: z.number().int().positive(),
  startIndex: z.number().int().min(0),
});

/** Validates a complete file manifest. */
export const ManifestSchema = z.object({
  version: z.number().int().min(1).max(2).default(1),
  slug: z.string().min(1),
  filename: z.string().min(1),
  size: z.number().int().min(0),
  chunks: z.array(ChunkSchema),
  encryption: EncryptionSchema.optional(),
  compression: CompressionSchema.optional(),
  chunking: ChunkingSchema.optional(),
  subManifests: z.array(SubManifestRefSchema).optional(),
});
