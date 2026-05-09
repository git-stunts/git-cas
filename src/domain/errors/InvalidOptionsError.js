import CasError from './CasError.js';
import { ErrorCodes } from './Codes.js';

export default class InvalidOptionsError extends CasError {
  static code = ErrorCodes.INVALID_OPTIONS;

  constructor(message, meta = {}) {
    super(message, InvalidOptionsError.code, meta);
  }
}
