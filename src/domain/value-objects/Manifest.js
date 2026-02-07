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
   * @param {{ algorithm: string, nonce: string, tag: string, encrypted: boolean }} [data.encryption] - Encryption metadata.
   * @throws {Error} If data fails schema validation.
   */
  constructor(data) {
    try {
      ManifestSchema.parse(data);
      this.slug = data.slug;
      this.filename = data.filename;
      this.size = data.size;
      this.chunks = data.chunks.map((c) => new Chunk(c));
      this.encryption = data.encryption ? { ...data.encryption } : undefined;
      Object.freeze(this);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(`Invalid manifest data: ${error.issues.map((i) => i.message).join(', ')}`);
      }
      throw error;
    }
  }

  /**
   * Serializes the manifest to a plain object suitable for JSON/CBOR encoding.
   * @returns {{ slug: string, filename: string, size: number, chunks: Array, encryption?: Object }}
   */
  toJSON() {
    return {
      slug: this.slug,
      filename: this.filename,
      size: this.size,
      chunks: this.chunks,
      encryption: this.encryption,
    };
  }
}
