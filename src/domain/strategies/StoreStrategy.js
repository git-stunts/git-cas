import {
  SCHEME_CONVERGENT,
  SCHEME_FRAMED,
} from '../encryption/schemes.js';

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
    if (keyInfo.key && encryptionConfig?.scheme === SCHEME_CONVERGENT) {
      return strategies.convergent;
    }
    if (keyInfo.key) {
      StoreStrategy.#warnEncryptedCdc({ chunker, observability });
      if (encryptionConfig?.scheme === SCHEME_FRAMED) {
        return strategies.framed;
      }
      return strategies.whole;
    }
    return strategies.plain;
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
