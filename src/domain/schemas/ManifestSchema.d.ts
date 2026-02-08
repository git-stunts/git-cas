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

/** Validates KDF parameters stored alongside encryption metadata. */
export declare const KdfSchema: z.ZodObject<{
  algorithm: z.ZodEnum<["pbkdf2", "scrypt"]>;
  salt: z.ZodString;
  iterations: z.ZodOptional<z.ZodNumber>;
  cost: z.ZodOptional<z.ZodNumber>;
  blockSize: z.ZodOptional<z.ZodNumber>;
  parallelization: z.ZodOptional<z.ZodNumber>;
  keyLength: z.ZodDefault<z.ZodNumber>;
}>;

/** Validates the encryption metadata attached to an encrypted manifest. */
export declare const EncryptionSchema: z.ZodObject<{
  algorithm: z.ZodString;
  nonce: z.ZodString;
  tag: z.ZodString;
  encrypted: z.ZodDefault<z.ZodBoolean>;
  kdf: z.ZodOptional<typeof KdfSchema>;
}>;

/** Validates compression metadata. */
export declare const CompressionSchema: z.ZodObject<{
  algorithm: z.ZodEnum<["gzip"]>;
}>;

/** Validates a sub-manifest reference in a v2 Merkle manifest. */
export declare const SubManifestRefSchema: z.ZodObject<{
  oid: z.ZodString;
  chunkCount: z.ZodNumber;
  startIndex: z.ZodNumber;
}>;

/** Validates a complete file manifest. */
export declare const ManifestSchema: z.ZodObject<{
  version: z.ZodDefault<z.ZodNumber>;
  slug: z.ZodString;
  filename: z.ZodString;
  size: z.ZodNumber;
  chunks: z.ZodArray<typeof ChunkSchema>;
  encryption: z.ZodOptional<typeof EncryptionSchema>;
  compression: z.ZodOptional<typeof CompressionSchema>;
  subManifests: z.ZodOptional<z.ZodArray<typeof SubManifestRefSchema>>;
}>;
