import CasError from './CasError.js';
import { ErrorCodes } from './Codes.js';

export default class ManifestNotFoundError extends CasError {
  static code = ErrorCodes.MANIFEST_NOT_FOUND;

  constructor(message, meta = {}) {
    super(message, ManifestNotFoundError.code, meta);
  }
}
