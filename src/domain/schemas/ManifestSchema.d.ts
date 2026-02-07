/**
 * @module
 * Zod schemas for validating CAS manifest and chunk data.
 */

import { z } from "zod";

/** Validates a single chunk entry within a manifest. */
export declare const ChunkSchema: z.ZodObject<{
  index: z.ZodNumber;
  size: z.ZodNumber;
  digest: z.ZodString;
  blob: z.ZodString;
}>;

/** Validates the encryption metadata attached to an encrypted manifest. */
export declare const EncryptionSchema: z.ZodObject<{
  algorithm: z.ZodString;
  nonce: z.ZodString;
  tag: z.ZodString;
  encrypted: z.ZodDefault<z.ZodBoolean>;
}>;

/** Validates a complete file manifest. */
export declare const ManifestSchema: z.ZodObject<{
  slug: z.ZodString;
  filename: z.ZodString;
  size: z.ZodNumber;
  chunks: z.ZodArray<typeof ChunkSchema>;
  encryption: z.ZodOptional<typeof EncryptionSchema>;
}>;
