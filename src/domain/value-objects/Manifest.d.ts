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

/** AES-256-GCM encryption metadata attached to an encrypted manifest. */
export interface EncryptionMeta {
  algorithm: string;
  nonce: string;
  tag: string;
  encrypted: boolean;
  kdf?: KdfParams;
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
