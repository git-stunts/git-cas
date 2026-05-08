import CasError from './CasError.js';
import { ErrorCodes } from './Codes.js';

export default class PersistenceCapabilityRequiredError extends CasError {
  static code = ErrorCodes.PERSISTENCE_CAPABILITY_REQUIRED;

  constructor(message, meta = {}) {
    super(message, PersistenceCapabilityRequiredError.code, meta);
  }
}
