import { describe, expect, it, vi } from 'vitest';
import CasError from '../../../../src/domain/errors/CasError.js';
import VaultMutationRetryPolicy from '../../../../src/domain/services/VaultMutationRetryPolicy.js';

describe('VaultMutationRetryPolicy', () => {
  it('classifies only VAULT_CONFLICT as retryable', () => {
    const policy = new VaultMutationRetryPolicy();

    expect(policy.isRetryable(new CasError('conflict', 'VAULT_CONFLICT'))).toBe(true);
    expect(policy.isRetryable(new CasError('missing', 'VAULT_ENTRY_NOT_FOUND'))).toBe(false);
  });

  it('uses injectable delay and random sources for exponential jitter', async () => {
    const sleep = vi.fn();
    const policy = new VaultMutationRetryPolicy({
      maxAttempts: 4,
      baseDelayMs: 10,
      random: () => 0.5,
      sleep,
    });

    await policy.waitBeforeRetry(2);

    expect(policy.maxAttempts).toBe(4);
    expect(sleep).toHaveBeenCalledWith(50);
  });

  it('rejects invalid retry configuration with CasError', () => {
    expect(() => new VaultMutationRetryPolicy({ maxAttempts: 0 })).toThrow(
      expect.objectContaining({ code: 'VAULT_RETRY_POLICY_INVALID' }),
    );
  });
});
