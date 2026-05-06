import CasError from './CasError.js';

export default class IntegrityError extends CasError {
  static code = 'INTEGRITY_ERROR';

  constructor(message, meta = {}) {
    super(message, IntegrityError.code, meta);
  }
}
