import CasError from './CasError.js';

export default class PersistenceCapabilityRequiredError extends CasError {
  static code = 'PERSISTENCE_CAPABILITY_REQUIRED';

  constructor(message, meta = {}) {
    super(message, PersistenceCapabilityRequiredError.code, meta);
  }
}
