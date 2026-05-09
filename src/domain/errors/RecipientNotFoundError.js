import CasError from './CasError.js';
import { ErrorCodes } from './Codes.js';

export default class RecipientNotFoundError extends CasError {
  static code = ErrorCodes.RECIPIENT_NOT_FOUND;

  constructor(message, meta = {}) {
    super(message, RecipientNotFoundError.code, meta);
  }
}
