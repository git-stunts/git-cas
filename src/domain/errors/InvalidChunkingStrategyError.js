import CasError from './CasError.js';
import { ErrorCodes } from './Codes.js';

export default class InvalidChunkingStrategyError extends CasError {
  static code = ErrorCodes.INVALID_CHUNKING_STRATEGY;

  constructor(message, meta = {}) {
    super(message, InvalidChunkingStrategyError.code, meta);
  }
}
