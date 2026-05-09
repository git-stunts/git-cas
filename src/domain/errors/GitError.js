import CasError from './CasError.js';
import { ErrorCodes } from './Codes.js';

export default class GitError extends CasError {
  static code = ErrorCodes.GIT_ERROR;

  constructor(message, meta = {}) {
    super(message, GitError.code, meta);
  }
}
