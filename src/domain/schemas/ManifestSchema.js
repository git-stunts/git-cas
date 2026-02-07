/* @ts-self-types="./ManifestSchema.d.ts" */
/**
 * @fileoverview Zod schemas for validating CAS manifest and chunk data.
 */

import z from 'zod';

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

/** Validates the encryption metadata attached to an encrypted manifest. */
export const EncryptionSchema = z.object({
  algorithm: z.string(),
  nonce: z.string(),
  tag: z.string(),
  encrypted: z.boolean().default(true),
  kdf: KdfSchema.optional(),
});

/** Validates compression metadata. */
export const CompressionSchema = z.object({
  algorithm: z.enum(['gzip']),
});

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
  subManifests: z.array(SubManifestRefSchema).optional(),
});
