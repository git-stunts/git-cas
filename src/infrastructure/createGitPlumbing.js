/**
 * @fileoverview Shared GitPlumbing factory helpers for runtime-aware CLI and
 * test wiring.
 */

import GitPlumbingFactoryAdapter, {
  resolveGitRunnerEnv,
} from './adapters/GitPlumbingFactoryAdapter.js';

const defaultFactory = new GitPlumbingFactoryAdapter();

export { resolveGitRunnerEnv };

/**
 * Construct a GitPlumbing instance for the requested working tree.
 *
 * @param {{ cwd?: string, env?: string, factory?: GitPlumbingFactoryAdapter }} [options]
 * @returns {Promise<import('@git-stunts/plumbing').default>}
 */
export async function createGitPlumbing({ cwd = '.', env, factory = defaultFactory } = {}) {
  return await factory.create({ cwd, env });
}
