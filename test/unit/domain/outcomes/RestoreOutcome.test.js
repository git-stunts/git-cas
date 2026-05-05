import { describe, it, expect } from 'vitest';
import RestoreOutcome from '../../../../src/domain/outcomes/RestoreOutcome.js';

describe('RestoreOutcome', () => {
  it('freezes restore results and derives bytesWritten', () => {
    const outcome = RestoreOutcome.success(new Uint8Array([1, 2, 3]));

    expect(outcome.bytesWritten).toBe(3);
    expect(Object.isFrozen(outcome)).toBe(true);
  });

  it('can materialize from chunks', () => {
    const outcome = RestoreOutcome.fromChunks([new Uint8Array([1]), new Uint8Array([2])]);

    expect([...outcome.buffer]).toEqual([1, 2]);
  });
});
