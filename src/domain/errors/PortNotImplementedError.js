import CasError from './CasError.js';

export default class PortNotImplementedError extends CasError {
  static code = 'PORT_NOT_IMPLEMENTED';

  constructor(message, meta = {}) {
    super(message, PortNotImplementedError.code, meta);
  }
}
