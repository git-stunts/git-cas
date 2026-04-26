import { ManifestSchema } from '../schemas/ManifestSchema.js';
import Chunk from './Chunk.js';
import { ZodError } from 'zod';

/**
 * Immutable value object representing a file manifest.
 *
 * Validated against {@link ManifestSchema} on construction. Contains the slug,
 * filename, total size, an ordered array of {@link Chunk} objects, and optional
 * encryption metadata.
 */
export default class Manifest {
  /**
   * @param {Object} data - Raw manifest data (validated via Zod).
   * @param {string} data.slug - Logical identifier for the stored asset.
   * @param {string} data.filename - Original filename.
   * @param {number} data.size - Total size in bytes.
   * @param {Array<{ index: number, size: number, digest: string, blob: string }>} data.chunks - Chunk metadata.
   * @param {{ algorithm: string, nonce?: string, tag?: string, frameBytes?: number, encrypted: boolean }} [data.encryption] - Encryption metadata.
   * @throws {Error} If data fails schema validation.
   */
  constructor(data) {
    try {
      const parsed = ManifestSchema.parse(data);
      this.version = parsed.version;
      this.formatVersion = parsed.formatVersion;
      this.slug = parsed.slug;
      this.filename = parsed.filename;
      this.size = parsed.size;
      this.chunks = parsed.chunks.map((c) => new Chunk(c));
      this.encryption = parsed.encryption
        ? { ...parsed.encryption, recipients: parsed.encryption.recipients?.map((r) => ({ ...r })) }
        : undefined;
      this.compression = parsed.compression ? { ...parsed.compression } : undefined;
      this.chunking = parsed.chunking
        ? { strategy: parsed.chunking.strategy, params: { ...parsed.chunking.params } }
        : undefined;
      this.subManifests = parsed.subManifests ? parsed.subManifests.map((s) => ({ ...s })) : undefined;
      this.manifestHash = parsed.manifestHash;
      Manifest.#deepFreeze(this);
      Object.freeze(this);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(`Invalid manifest data: ${error.issues.map((i) => i.message).join(', ')}`);
      }
      throw error;
    }
  }

  /**
   * Deep-freezes nested mutable objects on a Manifest instance.
   * Called before the top-level `Object.freeze(this)`.
   * @param {Manifest} manifest
   */
  static #deepFreeze(manifest) {
    if (manifest.encryption) {
      if (manifest.encryption.kdf) { Object.freeze(manifest.encryption.kdf); }
      if (manifest.encryption.recipients) {
        manifest.encryption.recipients.forEach((r) => Object.freeze(r));
        Object.freeze(manifest.encryption.recipients);
      }
      Object.freeze(manifest.encryption);
    }
    if (manifest.compression) { Object.freeze(manifest.compression); }
    if (manifest.chunking) {
      if (manifest.chunking.params) { Object.freeze(manifest.chunking.params); }
      Object.freeze(manifest.chunking);
    }
    if (manifest.subManifests) {
      manifest.subManifests.forEach((s) => Object.freeze(s));
      Object.freeze(manifest.subManifests);
    }
    if (manifest.chunks) { Object.freeze(manifest.chunks); }
  }

  /**
   * Serializes the manifest to a mutable plain object suitable for JSON/CBOR encoding.
   * Returns deep copies of nested objects so callers can freely mutate the result.
   * @returns {{ slug: string, filename: string, size: number, chunks: Array, encryption?: Object }}
   */
  toJSON() {
    const obj = {
      version: this.version,
      formatVersion: this.formatVersion,
      slug: this.slug,
      filename: this.filename,
      size: this.size,
      chunks: this.chunks.map((c) => ({ ...c })),
      encryption: this.encryption
        ? { ...this.encryption, recipients: this.encryption.recipients?.map((r) => ({ ...r })) }
        : undefined,
      compression: this.compression ? { ...this.compression } : undefined,
      chunking: this.chunking
        ? { ...this.chunking, params: { ...this.chunking.params } }
        : undefined,
      subManifests: this.subManifests ? this.subManifests.map((s) => ({ ...s })) : undefined,
      manifestHash: this.manifestHash,
    };
    // Remove undefined values for CBOR codec compatibility
    for (const key of Object.keys(obj)) {
      if (obj[key] === undefined) { delete obj[key]; }
    }
    return obj;
  }
}
