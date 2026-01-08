import { ChunkSchema } from '../schemas/ManifestSchema.js';
import { ZodError } from 'zod';

/**
 * Value object representing a content chunk.
 */
export default class Chunk {
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
