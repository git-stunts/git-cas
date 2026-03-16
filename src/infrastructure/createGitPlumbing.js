import GitPlumbing, { ShellRunnerFactory } from '@git-stunts/plumbing';

export function resolveGitRunnerEnv() {
  return typeof globalThis.Bun !== 'undefined' ? ShellRunnerFactory.ENV_NODE : undefined;
}

export function createGitRunner({ env } = {}) {
  const runnerEnv = env ?? resolveGitRunnerEnv();
  return runnerEnv
    ? ShellRunnerFactory.create({ env: runnerEnv })
    : ShellRunnerFactory.create();
}

export function createGitPlumbing({ cwd = '.', env } = {}) {
  return new GitPlumbing({
    runner: createGitRunner({ env }),
    cwd,
  });
}
