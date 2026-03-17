import { describe, it, expect } from 'vitest';
import { createGitPlumbing, resolveGitRunnerEnv } from '../../../src/infrastructure/createGitPlumbing.js';

describe('createGitPlumbing helpers', () => {
  it('uses the node runner path under Bun and native defaults elsewhere', () => {
    const expected = typeof globalThis.Bun !== 'undefined' ? 'node' : undefined;
    expect(resolveGitRunnerEnv()).toBe(expected);
  });

  it('creates a plumbing instance for the requested cwd', () => {
    const plumbing = createGitPlumbing({ cwd: process.cwd() });
    expect(plumbing).toBeDefined();
    expect(typeof plumbing.execute).toBe('function');
  });
});
