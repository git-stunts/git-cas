import { ManifestSchema } from '../schemas/ManifestSchema.js';
import Chunk from './Chunk.js';
import { ZodError } from 'zod';

/**
 * Value object representing a file manifest.
 */
export default class Manifest {
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
