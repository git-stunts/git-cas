import CasError from './CasError.js';
import { ErrorCodes } from './Codes.js';

export default class NoMatchingRecipientError extends CasError {
  static code = ErrorCodes.NO_MATCHING_RECIPIENT;

  constructor(message, meta = {}) {
    super(message, NoMatchingRecipientError.code, meta);
  }
}
