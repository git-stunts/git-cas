import CasError from './CasError.js';

export default class InvalidChunkingStrategyError extends CasError {
  static code = 'INVALID_CHUNKING_STRATEGY';

  constructor(message, meta = {}) {
    super(message, InvalidChunkingStrategyError.code, meta);
  }
}
