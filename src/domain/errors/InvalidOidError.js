import CasError from './CasError.js';

export default class InvalidOidError extends CasError {
  static code = 'INVALID_OID';

  constructor(message, meta = {}) {
    super(message, InvalidOidError.code, meta);
  }
}
