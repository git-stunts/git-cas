import {
  SCHEME_CONVERGENT,
  SCHEME_FRAMED,
  SCHEME_WHOLE,
} from '../encryption/schemes.js';
import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';

const ENCRYPTED_STRATEGY_BY_SCHEME = Object.freeze({
  [SCHEME_CONVERGENT]: 'convergent',
  [SCHEME_FRAMED]: 'framed',
  [SCHEME_WHOLE]: 'whole',
});

/**
 * Selects the store strategy entity for the current request.
 */
export default class StoreStrategy {
  /**
   * @param {Object} options
   * @param {{ key?: Uint8Array }} options.keyInfo
   * @param {{ scheme?: string }} [options.encryptionConfig]
   * @param {{ strategy?: string }} options.chunker
   * @param {{ log: Function }} options.observability
   * @param {{ plain: object, convergent: object, framed: object, whole: object }} options.strategies
   * @returns {object}
   */
  static for({ keyInfo, encryptionConfig, chunker, observability, strategies }) {
    if (!keyInfo.key) {
      return strategies.plain;
    }

    const strategyName = StoreStrategy.#resolveEncryptedStrategyName(encryptionConfig?.scheme);
    if (strategyName !== 'convergent') {
      StoreStrategy.#warnEncryptedCdc({ chunker, observability });
    }
    return strategies[strategyName];
  }

  static #resolveEncryptedStrategyName(scheme) {
    if (Object.hasOwn(ENCRYPTED_STRATEGY_BY_SCHEME, scheme)) {
      return ENCRYPTED_STRATEGY_BY_SCHEME[scheme];
    }
    throw createCasError(
      `Encrypted store requires a current encryption scheme; received ${scheme ?? 'none'}`,
      ErrorCodes.INVALID_OPTIONS,
      { scheme },
    );
  }

  static #warnEncryptedCdc({ chunker, observability }) {
    if (chunker.strategy !== 'cdc') {
      return;
    }
    observability.log(
      'warn',
      'CDC deduplication is ineffective with encryption — ciphertext is pseudorandom',
      { strategy: 'cdc' },
    );
  }
}
