import CasError from './CasError.js';

export default class RecipientNotFoundError extends CasError {
  static code = 'RECIPIENT_NOT_FOUND';

  constructor(message, meta = {}) {
    super(message, RecipientNotFoundError.code, meta);
  }
}
