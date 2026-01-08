import GitPersistencePort from '../../ports/GitPersistencePort.js';

/**
 * Implementation of GitPersistencePort using GitPlumbing.
 */
export default class GitPersistenceAdapter extends GitPersistencePort {
  /**
   * @param {Object} options
   * @param {import('../../../plumbing/index.js').default} options.plumbing
   */
  constructor({ plumbing }) {
    super();
    this.plumbing = plumbing;
  }

  async writeBlob(content) {
    return await this.plumbing.execute({
      args: ['hash-object', '-w', '--stdin'],
      input: content,
    });
  }

  async writeTree(entries) {
    return await this.plumbing.execute({
      args: ['mktree'],
      input: `${entries.join('\n')}\n`,
    });
  }
}
