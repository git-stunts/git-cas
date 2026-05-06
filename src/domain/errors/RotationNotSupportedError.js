import CasError from './CasError.js';

export default class RotationNotSupportedError extends CasError {
  static code = 'ROTATION_NOT_SUPPORTED';

  constructor(message, meta = {}) {
    super(message, RotationNotSupportedError.code, meta);
  }
}
