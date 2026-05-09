import CasError from './CasError.js';
import { ErrorCodes } from './Codes.js';

export default class DekUnwrapFailedError extends CasError {
  static code = ErrorCodes.DEK_UNWRAP_FAILED;

  constructor(message, meta = {}) {
    super(message, DekUnwrapFailedError.code, meta);
  }
}
