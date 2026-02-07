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

/** Validates the encryption metadata attached to an encrypted manifest. */
export const EncryptionSchema = z.object({
  algorithm: z.string(),
  nonce: z.string(),
  tag: z.string(),
  encrypted: z.boolean().default(true),
});

/** Validates a complete file manifest. */
export const ManifestSchema = z.object({
  slug: z.string().min(1),
  filename: z.string().min(1),
  size: z.number().int().min(0),
  chunks: z.array(ChunkSchema),
  encryption: EncryptionSchema.optional(),
});
