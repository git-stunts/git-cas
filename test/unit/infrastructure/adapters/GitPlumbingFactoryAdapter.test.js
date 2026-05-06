import { describe, expect, it, vi } from 'vitest';
import GitPlumbingInitializationError from '../../../../src/domain/errors/GitPlumbingInitializationError.js';
import GitPlumbingFactoryAdapter, {
  resolveGitRunnerEnv,
} from '../../../../src/infrastructure/adapters/GitPlumbingFactoryAdapter.js';

describe('GitPlumbingFactoryAdapter', () => {
  it('delegates to the async plumbing v3 factory', async () => {
    const plumbing = { execute: vi.fn(), executeStream: vi.fn() };
    const GitPlumbingClass = {
      createDefault: vi.fn(async () => plumbing),
    };
    const adapter = new GitPlumbingFactoryAdapter({ GitPlumbingClass });

    await expect(adapter.create({ cwd: '/repo' })).resolves.toBe(plumbing);
    expect(GitPlumbingClass.createDefault).toHaveBeenCalledWith({ cwd: '/repo' });
  });

  it('keeps the Bun runner override inside the adapter boundary', async () => {
    const GitPlumbingClass = {
      createDefault: vi.fn(async () => ({ execute: vi.fn(), executeStream: vi.fn() })),
    };
    const shellRunnerFactory = { ENV_NODE: 'node' };
    const adapter = new GitPlumbingFactoryAdapter({
      GitPlumbingClass,
      shellRunnerFactory,
      runtime: { Bun: {} },
    });

    await adapter.create({ cwd: '/repo' });

    expect(GitPlumbingClass.createDefault).toHaveBeenCalledWith({
      cwd: '/repo',
      env: 'node',
    });
  });

  it('wraps plumbing initialization failures in a domain-specific error', async () => {
    const originalError = new TypeError('invalid cwd');
    const GitPlumbingClass = {
      createDefault: vi.fn(async () => {
        throw originalError;
      }),
    };
    const adapter = new GitPlumbingFactoryAdapter({ GitPlumbingClass });

    await expect(adapter.create({ cwd: '/missing' })).rejects.toMatchObject({
      constructor: GitPlumbingInitializationError,
      code: 'GIT_PLUMBING_INITIALIZATION_FAILED',
      meta: {
        cwd: '/missing',
        originalError,
      },
    });
  });
});

describe('resolveGitRunnerEnv', () => {
  it('resolves the Bun runner override without exposing plumbing constants upstream', () => {
    expect(resolveGitRunnerEnv({ Bun: {} }, { ENV_NODE: 'node' })).toBe('node');
    expect(resolveGitRunnerEnv({}, { ENV_NODE: 'node' })).toBeUndefined();
  });
});
