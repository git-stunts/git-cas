import GitPlumbing, { ShellRunnerFactory } from '@git-stunts/plumbing';
import GitPlumbingInitializationError from '../../domain/errors/GitPlumbingInitializationError.js';
import GitPlumbingFactoryPort from '../../ports/GitPlumbingFactoryPort.js';

/**
 * @param {{ Bun?: unknown }} runtime
 * @param {{ ENV_NODE?: string }} shellRunnerFactory
 * @returns {string | undefined}
 */
export function resolveGitRunnerEnv(runtime = globalThis, shellRunnerFactory = ShellRunnerFactory) {
  return typeof runtime.Bun !== 'undefined' ? shellRunnerFactory.ENV_NODE : undefined;
}

function optionsForCreateDefault({ cwd, env }) {
  const options = { cwd };
  if (env !== undefined) {
    options.env = env;
  }
  return options;
}

export default class GitPlumbingFactoryAdapter extends GitPlumbingFactoryPort {
  #GitPlumbingClass;
  #runtime;
  #shellRunnerFactory;

  /**
   * @param {Object} [options]
   * @param {typeof GitPlumbing} [options.GitPlumbingClass]
   * @param {typeof ShellRunnerFactory} [options.shellRunnerFactory]
   * @param {{ Bun?: unknown }} [options.runtime]
   */
  constructor({
    GitPlumbingClass = GitPlumbing,
    shellRunnerFactory = ShellRunnerFactory,
    runtime = globalThis,
  } = {}) {
    super();
    this.#GitPlumbingClass = GitPlumbingClass;
    this.#shellRunnerFactory = shellRunnerFactory;
    this.#runtime = runtime;
  }

  /**
   * @param {{ cwd?: string, env?: string }} [options]
   * @returns {Promise<GitPlumbing>}
   */
  async create({ cwd = '.', env } = {}) {
    const runnerEnv = env ?? resolveGitRunnerEnv(this.#runtime, this.#shellRunnerFactory);
    const createOptions = optionsForCreateDefault({ cwd, env: runnerEnv });

    try {
      return await this.#GitPlumbingClass.createDefault(createOptions);
    } catch (error) {
      throw new GitPlumbingInitializationError(`Failed to initialize Git plumbing for cwd "${cwd}"`, {
        cwd,
        env: runnerEnv,
        originalError: error,
      });
    }
  }
}
