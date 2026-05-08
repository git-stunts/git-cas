import CasError from './CasError.js';
import { ErrorCodes } from './Codes.js';

export default class PortNotImplementedError extends CasError {
  static code = ErrorCodes.PORT_NOT_IMPLEMENTED;

  constructor(message, meta = {}) {
    super(message, PortNotImplementedError.code, meta);
  }
}
