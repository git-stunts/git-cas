import CasError from './CasError.js';

export default class ManifestIntegrityError extends CasError {
  static code = 'MANIFEST_INTEGRITY_ERROR';

  constructor(message, meta = {}) {
    super(message, ManifestIntegrityError.code, meta);
  }
}
