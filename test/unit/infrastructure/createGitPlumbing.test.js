import { describe, it, expect } from 'vitest';
import { createGitPlumbing, resolveGitRunnerEnv } from '../../../src/infrastructure/createGitPlumbing.js';

describe('createGitPlumbing helpers', () => {
  it('uses the node runner path under Bun and native defaults elsewhere', () => {
    const expected = typeof globalThis.Bun !== 'undefined' ? 'node' : undefined;
    expect(resolveGitRunnerEnv()).toBe(expected);
  });

  it('creates a plumbing instance for the requested cwd', async () => {
    const plumbing = await createGitPlumbing({ cwd: process.cwd() });
    expect(plumbing).toBeDefined();
    expect(typeof plumbing.execute).toBe('function');
  });

  it('delegates creation through an injectable factory port', async () => {
    const plumbing = { execute: () => {}, executeStream: () => {} };
    const factory = {
      create: async (options) => ({ ...plumbing, options }),
    };

    await expect(createGitPlumbing({ cwd: '/repo', env: 'node', factory })).resolves.toEqual({
      ...plumbing,
      options: { cwd: '/repo', env: 'node' },
    });
  });
});
