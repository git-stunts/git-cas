import CasError from './CasError.js';

export default class DekUnwrapFailedError extends CasError {
  static code = 'DEK_UNWRAP_FAILED';

  constructor(message, meta = {}) {
    super(message, DekUnwrapFailedError.code, meta);
  }
}
