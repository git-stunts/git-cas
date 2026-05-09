import CasError from './CasError.js';
import { ErrorCodes } from './Codes.js';

export default class RecipientAlreadyExistsError extends CasError {
  static code = ErrorCodes.RECIPIENT_ALREADY_EXISTS;

  constructor(message, meta = {}) {
    super(message, RecipientAlreadyExistsError.code, meta);
  }
}
