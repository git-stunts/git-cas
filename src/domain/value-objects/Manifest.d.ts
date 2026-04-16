import Chunk from "./Chunk.js";

/** KDF parameters stored alongside encryption metadata. */
export interface KdfParams {
  algorithm: "pbkdf2" | "scrypt";
  salt: string;
  iterations?: number;
  cost?: number;
  blockSize?: number;
  parallelization?: number;
  keyLength: number;
}

/** A single recipient entry in an envelope-encrypted manifest. */
export interface RecipientEntry {
  label: string;
  wrappedDek: string;
  nonce: string;
  tag: string;
  kekType?: string;
  keyVersion?: number;
}

export type EncryptionScheme = "whole-v1" | "framed-v1";

/** AES-256-GCM encryption metadata attached to an encrypted manifest. */
export interface EncryptionMeta {
  scheme?: EncryptionScheme | (string & {});
  algorithm: string;
  nonce?: string;
  tag?: string;
  frameBytes?: number;
  encrypted: boolean;
  kdf?: KdfParams;
  recipients?: RecipientEntry[];
  keyVersion?: number;
}

/** Compression metadata. */
export interface CompressionMeta {
  algorithm: "gzip";
}

/** Sub-manifest reference in a v2 Merkle manifest. */
export interface SubManifestRef {
  oid: string;
  chunkCount: number;
  startIndex: number;
}

/** Raw manifest data accepted by the {@link Manifest} constructor. */
export interface ManifestData {
  version?: number;
  slug: string;
  filename: string;
  size: number;
  chunks: Array<{ index: number; size: number; digest: string; blob: string }>;
  encryption?: EncryptionMeta;
  compression?: CompressionMeta;
  subManifests?: SubManifestRef[];
}

/**
 * Immutable value object representing a file manifest.
 */
export default class Manifest {
  readonly version: number;
  readonly slug: string;
  readonly filename: string;
  readonly size: number;
  readonly chunks: readonly Chunk[];
  readonly encryption?: EncryptionMeta;
  readonly compression?: CompressionMeta;
  readonly subManifests?: readonly SubManifestRef[];

  constructor(data: ManifestData);

  toJSON(): ManifestData;
}
