import CasError from './CasError.js';

export default class NoMatchingRecipientError extends CasError {
  static code = 'NO_MATCHING_RECIPIENT';

  constructor(message, meta = {}) {
    super(message, NoMatchingRecipientError.code, meta);
  }
}
