import CasError from './CasError.js';
import { ErrorCodes } from './Codes.js';

export default class IntegrityError extends CasError {
  static code = ErrorCodes.INTEGRITY_ERROR;

  constructor(message, meta = {}) {
    super(message, IntegrityError.code, meta);
  }
}
