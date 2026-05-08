import CasError from './CasError.js';
import { ErrorCodes } from './Codes.js';

export default class GitPlumbingInitializationError extends CasError {
  static code = ErrorCodes.GIT_PLUMBING_INITIALIZATION_FAILED;

  constructor(message, meta = {}) {
    super(message, GitPlumbingInitializationError.code, meta);
  }
}
