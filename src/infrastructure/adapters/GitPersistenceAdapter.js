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

  async readBlob(oid) {
    // Assuming plumbing.execute returns string (stdout). 
    // Ideally plumbing should support binary output.
    // For now, we assume text or we need to fix plumbing to return Buffer.
    // Re-checking plumbing: execute returns string. executeStream returns stream.
    
    // We need binary. plumbing.executeStream is the way.
    const stream = await this.plumbing.executeStream({
      args: ['cat-file', 'blob', oid]
    });
    
    return await stream.collect({ asString: false }); // Buffer
  }
}
