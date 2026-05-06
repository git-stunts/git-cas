import CasError from './CasError.js';

export default class InvalidOptionsError extends CasError {
  static code = 'INVALID_OPTIONS';

  constructor(message, meta = {}) {
    super(message, InvalidOptionsError.code, meta);
  }
}
