import CasError from './CasError.js';
import { ErrorCodes } from './Codes.js';

export default class InvalidOidError extends CasError {
  static code = ErrorCodes.INVALID_OID;

  constructor(message, meta = {}) {
    super(message, InvalidOidError.code, meta);
  }
}
