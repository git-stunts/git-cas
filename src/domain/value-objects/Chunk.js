import { ChunkSchema } from '../schemas/ManifestSchema.js';
import { ZodError } from 'zod';

/**
 * Immutable value object representing a single content chunk.
 *
 * Validated against {@link ChunkSchema} on construction. Properties are
 * assigned via `Object.assign` and the instance is frozen.
 *
 * @property {number} index - Zero-based position within the manifest.
 * @property {number} size - Chunk size in bytes.
 * @property {string} digest - 64-character SHA-256 hex digest of the chunk data.
 * @property {string} blob - Git OID of the stored blob.
 */
export default class Chunk {
  /**
   * @param {Object} data - Raw chunk data (validated via Zod).
   * @param {number} data.index - Zero-based chunk index.
   * @param {number} data.size - Chunk size in bytes.
   * @param {string} data.digest - SHA-256 hex digest.
   * @param {string} data.blob - Git blob OID.
   * @throws {Error} If data fails schema validation.
   */
  constructor(data) {
    try {
      ChunkSchema.parse(data);
      Object.assign(this, data);
      Object.freeze(this);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(`Invalid chunk data: ${error.issues.map((i) => i.message).join(', ')}`);
      }
      throw error;
    }
  }
}
