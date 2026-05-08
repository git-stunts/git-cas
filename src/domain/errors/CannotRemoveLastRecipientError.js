import CasError from './CasError.js';
import { ErrorCodes } from './Codes.js';

export default class CannotRemoveLastRecipientError extends CasError {
  static code = ErrorCodes.CANNOT_REMOVE_LAST_RECIPIENT;

  constructor(message, meta = {}) {
    super(message, CannotRemoveLastRecipientError.code, meta);
  }
}
