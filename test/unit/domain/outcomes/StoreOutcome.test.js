import { describe, it, expect } from 'vitest';
import StoreOutcome from '../../../../src/domain/outcomes/StoreOutcome.js';

describe('StoreOutcome', () => {
  it('freezes store results', () => {
    const manifest = Object.freeze({ slug: 'asset' });
    const outcome = StoreOutcome.success(manifest);

    expect(outcome.manifest).toBe(manifest);
    expect(Object.isFrozen(outcome)).toBe(true);
  });
});
