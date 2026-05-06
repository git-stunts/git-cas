import { describe, it, expect } from 'vitest';
import RestoreOutcome from '../../../../src/domain/outcomes/RestoreOutcome.js';
import RestoreFailure from '../../../../src/domain/outcomes/RestoreFailure.js';
import RestoreSuccess from '../../../../src/domain/outcomes/RestoreSuccess.js';

describe('RestoreOutcome', () => {
  it('models successful restore results as a success subtype', () => {
    const outcome = new RestoreSuccess({ buffer: new Uint8Array([1, 2, 3]) });

    expect(outcome).toBeInstanceOf(RestoreOutcome);
    expect(outcome).toBeInstanceOf(RestoreSuccess);
    expect(outcome.ok).toBe(true);
    expect(outcome.bytesWritten).toBe(3);
    expect(Object.isFrozen(outcome)).toBe(true);
  });

  it('can materialize from chunks', () => {
    const outcome = RestoreSuccess.fromChunks([new Uint8Array([1]), new Uint8Array([2])]);

    expect([...outcome.buffer]).toEqual([1, 2]);
  });

  it('protects restored bytes from external mutation', () => {
    const source = new Uint8Array([1, 2, 3]);
    const outcome = new RestoreSuccess({ buffer: source });

    source[0] = 9;
    const returned = outcome.buffer;
    returned[1] = 8;

    expect([...outcome.buffer]).toEqual([1, 2, 3]);
  });

  it('models failed restore results as a failure subtype', () => {
    const error = new Error('restore failed');
    const outcome = new RestoreFailure({ error });

    expect(outcome).toBeInstanceOf(RestoreOutcome);
    expect(outcome).toBeInstanceOf(RestoreFailure);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe(error);
    expect(Object.isFrozen(outcome)).toBe(true);
  });
});
