import CasError from './CasError.js';
import { ErrorCodes } from './Codes.js';

export default class RotationNotSupportedError extends CasError {
  static code = ErrorCodes.ROTATION_NOT_SUPPORTED;

  constructor(message, meta = {}) {
    super(message, RotationNotSupportedError.code, meta);
  }
}
