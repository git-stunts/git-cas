import CasError from './CasError.js';

export default class ManifestNotFoundError extends CasError {
  static code = 'MANIFEST_NOT_FOUND';

  constructor(message, meta = {}) {
    super(message, ManifestNotFoundError.code, meta);
  }
}
