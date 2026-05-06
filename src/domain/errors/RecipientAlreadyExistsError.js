import CasError from './CasError.js';

export default class RecipientAlreadyExistsError extends CasError {
  static code = 'RECIPIENT_ALREADY_EXISTS';

  constructor(message, meta = {}) {
    super(message, RecipientAlreadyExistsError.code, meta);
  }
}
