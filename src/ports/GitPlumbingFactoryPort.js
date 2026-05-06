import PortNotImplementedError from '../domain/errors/PortNotImplementedError.js';

export default class GitPlumbingFactoryPort {
  /**
   * Creates a Git command executor for the requested working tree.
   *
   * @param {{ cwd?: string, env?: string }} _options
   * @returns {Promise<{ execute: Function, executeStream: Function }>}
   */
  async create(_options = {}) {
    throw new PortNotImplementedError('GitPlumbingFactoryPort.create() must be implemented', {
      port: 'GitPlumbingFactoryPort',
      method: 'create',
    });
  }
}
