/**
 * @fileoverview Shared GitPlumbing factory helpers for runtime-aware CLI and
 * test wiring.
 */

import GitPlumbing, { ShellRunnerFactory } from '@git-stunts/plumbing';

/**
 * Resolve the shell-runner environment override for the current runtime.
 *
 * Bun uses the Node-backed runner path because the native Bun subprocess path
 * is more prone to `git` I/O edge cases in this repository.
 *
 * @returns {string | undefined}
 */
export function resolveGitRunnerEnv() {
  return typeof globalThis.Bun !== 'undefined' ? ShellRunnerFactory.ENV_NODE : undefined;
}

/**
 * Create a shell runner with the runtime-appropriate environment override.
 *
 * @param {{ env?: string }} [options]
 * @returns {ReturnType<typeof ShellRunnerFactory.create>}
 */
export function createGitRunner({ env } = {}) {
  const runnerEnv = env ?? resolveGitRunnerEnv();
  return runnerEnv
    ? ShellRunnerFactory.create({ env: runnerEnv })
    : ShellRunnerFactory.create();
}

/**
 * Construct a GitPlumbing instance for the requested working tree.
 *
 * @param {{ cwd?: string, env?: string }} [options]
 * @returns {GitPlumbing}
 */
export function createGitPlumbing({ cwd = '.', env } = {}) {
  return new GitPlumbing({
    runner: createGitRunner({ env }),
    cwd,
  });
}
