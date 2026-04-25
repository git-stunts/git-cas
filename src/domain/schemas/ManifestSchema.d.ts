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

/** Validates a single recipient entry in an envelope-encrypted manifest. */
export declare const RecipientSchema: z.ZodObject<{
  label: z.ZodString;
  wrappedDek: z.ZodString;
  nonce: z.ZodString;
  tag: z.ZodString;
  kekType: z.ZodOptional<z.ZodString>;
  keyVersion: z.ZodOptional<z.ZodNumber>;
}>;

/** Validates the encryption metadata attached to an encrypted manifest. */
export declare const EncryptionSchema: z.ZodUnion<
  [
    z.ZodObject<{
      scheme: z.ZodLiteral<"whole">;
      algorithm: z.ZodLiteral<"aes-256-gcm">;
      encrypted: z.ZodDefault<z.ZodLiteral<true>>;
      kdf: z.ZodOptional<typeof KdfSchema>;
      recipients: z.ZodOptional<z.ZodArray<typeof RecipientSchema>>;
      keyVersion: z.ZodOptional<z.ZodNumber>;
      nonce: z.ZodString;
      tag: z.ZodString;
      frameBytes: z.ZodOptional<z.ZodUndefined>;
    }>,
    z.ZodObject<{
      scheme: z.ZodLiteral<"framed">;
      algorithm: z.ZodLiteral<"aes-256-gcm">;
      encrypted: z.ZodDefault<z.ZodLiteral<true>>;
      kdf: z.ZodOptional<typeof KdfSchema>;
      recipients: z.ZodOptional<z.ZodArray<typeof RecipientSchema>>;
      keyVersion: z.ZodOptional<z.ZodNumber>;
      frameBytes: z.ZodNumber;
      nonce: z.ZodOptional<z.ZodUndefined>;
      tag: z.ZodOptional<z.ZodUndefined>;
    }>,
    z.ZodObject<{
      scheme: z.ZodLiteral<"convergent">;
      algorithm: z.ZodLiteral<"aes-256-gcm">;
      encrypted: z.ZodDefault<z.ZodLiteral<true>>;
      kdf: z.ZodOptional<typeof KdfSchema>;
      recipients: z.ZodOptional<z.ZodArray<typeof RecipientSchema>>;
      keyVersion: z.ZodOptional<z.ZodNumber>;
      nonce: z.ZodOptional<z.ZodUndefined>;
      tag: z.ZodOptional<z.ZodUndefined>;
      frameBytes: z.ZodOptional<z.ZodUndefined>;
    }>
  ]
>;

/** Validates compression metadata. */
export declare const CompressionSchema: z.ZodObject<{
  algorithm: z.ZodEnum<["gzip"]>;
}>;

/** Validates fixed-size chunking parameters. */
export declare const FixedChunkingSchema: z.ZodObject<{
  strategy: z.ZodLiteral<"fixed">;
  params: z.ZodObject<{
    chunkSize: z.ZodNumber;
  }>;
}>;

/** Validates content-defined chunking (CDC) parameters. */
export declare const CdcChunkingSchema: z.ZodObject<{
  strategy: z.ZodLiteral<"cdc">;
  params: z.ZodObject<{
    target: z.ZodNumber;
    min: z.ZodNumber;
    max: z.ZodNumber;
  }>;
}>;

/** Validates chunking metadata (fixed or CDC). */
export declare const ChunkingSchema: z.ZodDiscriminatedUnion<
  "strategy",
  [typeof FixedChunkingSchema, typeof CdcChunkingSchema]
>;

/** Validates a sub-manifest reference in a v2 Merkle manifest. */
export declare const SubManifestRefSchema: z.ZodObject<{
  oid: z.ZodString;
  chunkCount: z.ZodNumber;
  startIndex: z.ZodNumber;
}>;

/** Validates a complete file manifest. */
export declare const ManifestSchema: z.ZodObject<{
  version: z.ZodDefault<z.ZodNumber>;
  formatVersion: z.ZodOptional<z.ZodString>;
  slug: z.ZodString;
  filename: z.ZodString;
  size: z.ZodNumber;
  chunks: z.ZodArray<typeof ChunkSchema>;
  encryption: z.ZodOptional<typeof EncryptionSchema>;
  compression: z.ZodOptional<typeof CompressionSchema>;
  chunking: z.ZodOptional<typeof ChunkingSchema>;
  subManifests: z.ZodOptional<z.ZodArray<typeof SubManifestRefSchema>>;
}>;
