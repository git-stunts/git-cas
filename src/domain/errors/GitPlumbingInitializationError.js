import CasError from './CasError.js';

export default class GitPlumbingInitializationError extends CasError {
  static code = 'GIT_PLUMBING_INITIALIZATION_FAILED';

  constructor(message, meta = {}) {
    super(message, GitPlumbingInitializationError.code, meta);
  }
}
