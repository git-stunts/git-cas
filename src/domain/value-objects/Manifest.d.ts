import Chunk from "./Chunk.js";

/** AES-256-GCM encryption metadata attached to an encrypted manifest. */
export interface EncryptionMeta {
  algorithm: string;
  nonce: string;
  tag: string;
  encrypted: boolean;
}

/** Raw manifest data accepted by the {@link Manifest} constructor. */
export interface ManifestData {
  slug: string;
  filename: string;
  size: number;
  chunks: Array<{ index: number; size: number; digest: string; blob: string }>;
  encryption?: EncryptionMeta;
}

/**
 * Immutable value object representing a file manifest.
 */
export default class Manifest {
  readonly slug: string;
  readonly filename: string;
  readonly size: number;
  readonly chunks: readonly Chunk[];
  readonly encryption?: EncryptionMeta;

  constructor(data: ManifestData);

  toJSON(): ManifestData;
}
