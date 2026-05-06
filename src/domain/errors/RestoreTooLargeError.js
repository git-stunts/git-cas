import CasError from './CasError.js';

export default class RestoreTooLargeError extends CasError {
  static code = 'RESTORE_TOO_LARGE';

  constructor(message, meta = {}) {
    super(message, RestoreTooLargeError.code, meta);
  }
}
