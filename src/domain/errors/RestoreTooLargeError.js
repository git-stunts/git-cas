import CasError from './CasError.js';
import { ErrorCodes } from './Codes.js';

export default class RestoreTooLargeError extends CasError {
  static code = ErrorCodes.RESTORE_TOO_LARGE;

  constructor(message, meta = {}) {
    super(message, RestoreTooLargeError.code, meta);
  }
}
