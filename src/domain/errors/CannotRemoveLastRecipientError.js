import CasError from './CasError.js';

export default class CannotRemoveLastRecipientError extends CasError {
  static code = 'CANNOT_REMOVE_LAST_RECIPIENT';

  constructor(message, meta = {}) {
    super(message, CannotRemoveLastRecipientError.code, meta);
  }
}
