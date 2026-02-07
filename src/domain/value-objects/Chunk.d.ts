/**
 * Immutable value object representing a single content chunk.
 */
export default class Chunk {
  readonly index: number;
  readonly size: number;
  readonly digest: string;
  readonly blob: string;

  constructor(data: {
    index: number;
    size: number;
    digest: string;
    blob: string;
  });
}
