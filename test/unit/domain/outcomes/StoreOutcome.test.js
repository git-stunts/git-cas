import { describe, it, expect } from 'vitest';
import StoreOutcome from '../../../../src/domain/outcomes/StoreOutcome.js';
import StoreFailure from '../../../../src/domain/outcomes/StoreFailure.js';
import StoreSuccess from '../../../../src/domain/outcomes/StoreSuccess.js';

describe('StoreOutcome', () => {
  it('models successful store results as a success subtype', () => {
    const manifest = Object.freeze({ slug: 'asset' });
    const outcome = new StoreSuccess({ manifest });

    expect(outcome).toBeInstanceOf(StoreOutcome);
    expect(outcome).toBeInstanceOf(StoreSuccess);
    expect(outcome.ok).toBe(true);
    expect(outcome.manifest).toBe(manifest);
    expect(Object.isFrozen(outcome)).toBe(true);
  });

  it('models failed store results as a failure subtype', () => {
    const error = new Error('store failed');
    const outcome = new StoreFailure({ error });

    expect(outcome).toBeInstanceOf(StoreOutcome);
    expect(outcome).toBeInstanceOf(StoreFailure);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe(error);
    expect(Object.isFrozen(outcome)).toBe(true);
  });
});
