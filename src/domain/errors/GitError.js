import CasError from './CasError.js';

export default class GitError extends CasError {
  static code = 'GIT_ERROR';

  constructor(message, meta = {}) {
    super(message, GitError.code, meta);
  }
}
