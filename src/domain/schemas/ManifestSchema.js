import z from 'zod';

export const ChunkSchema = z.object({
  index: z.number().int().min(0),
  size: z.number().int().positive(),
  digest: z.string().length(64), // SHA-256
  blob: z.string().min(1),       // Git OID
});

export const EncryptionSchema = z.object({
  algorithm: z.string(),
  nonce: z.string(),
  tag: z.string(),
  encrypted: z.boolean().default(true),
});

export const ManifestSchema = z.object({
  slug: z.string().min(1),
  filename: z.string().min(1),
  size: z.number().int().min(0),
  chunks: z.array(ChunkSchema),
  encryption: EncryptionSchema.optional(),
});
