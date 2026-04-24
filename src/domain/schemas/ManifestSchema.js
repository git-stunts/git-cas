/* @ts-self-types="./ManifestSchema.d.ts" */
/**
 * @fileoverview Zod schemas for validating CAS manifest and chunk data.
 */

import { Buffer } from 'node:buffer';
import z from 'zod';
import { isCanonicalBase64 } from '../../helpers/canonicalBase64.js';

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

/** Matches a lowercase hex Git OID — SHA-1 (40 chars) or SHA-256 (64 chars). */
const gitOidSchema = z.string().regex(
  /^[0-9a-f]{40}([0-9a-f]{24})?$/,
  'must be a 40- or 64-character lowercase hex Git OID',
);

/** Validates a single chunk entry within a manifest. */
export const ChunkSchema = z.object({
  index: z.number().int().min(0),
  size: z.number().int().positive(),
  digest: z.string().regex(/^[0-9a-f]{64}$/, 'digest must be a 64-character lowercase hex string'),
  blob: gitOidSchema,
});

/** Validates KDF parameters stored alongside encryption metadata. */
export const KdfSchema = z.object({
  algorithm: z.enum(['pbkdf2', 'scrypt']),
  salt: z.string()
    .min(1)
    .refine((value) => isCanonicalBase64(value), {
      message: 'salt must be canonical base64',
    }),
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
  scheme: z.enum(['whole-v1', 'whole-v2']).optional(),
  ...EncryptionBaseSchema,
  nonce: base64BytesSchema('nonce', 12),
  tag: base64BytesSchema('tag', 16),
  frameBytes: z.undefined().optional(),
});

const FramedEncryptionSchema = z.object({
  scheme: z.enum(['framed-v1', 'framed-v2']),
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
    normalized: z.boolean().optional(),
  }),
});

/** Validates chunking metadata (fixed or CDC). */
export const ChunkingSchema = z.discriminatedUnion('strategy', [
  FixedChunkingSchema,
  CdcChunkingSchema,
]);

/** Validates a sub-manifest reference in a v2 Merkle manifest. */
export const SubManifestRefSchema = z.object({
  oid: gitOidSchema,
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
  subManifests: z.array(SubManifestRefSchema).max(10_000).optional(),
});
