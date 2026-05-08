import CasError from './CasError.js';
import { ErrorCodes } from './Codes.js';

export default class ManifestIntegrityError extends CasError {
  static code = ErrorCodes.MANIFEST_INTEGRITY_ERROR;

  constructor(message, meta = {}) {
    super(message, ManifestIntegrityError.code, meta);
  }
}
