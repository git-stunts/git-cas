import {
  SCHEME_CONVERGENT,
  SCHEME_FRAMED,
  SCHEME_WHOLE,
} from '../encryption/schemes.js';

/**
 * Selects the restore strategy entity for a manifest.
 */
export default class RestoreStrategy {
  /**
   * @param {Object} options
   * @param {import('../value-objects/Manifest.js').default} options.manifest
   * @param {{ scheme?: string }} [options.encryptionMeta]
   * @param {{ plain: object, compressed: object, convergent: object, framed: object, whole: object }} options.strategies
   * @returns {object}
   */
  static for({ manifest, encryptionMeta, strategies }) {
    if (encryptionMeta?.scheme === SCHEME_CONVERGENT) {
      return strategies.convergent;
    }
    if (encryptionMeta?.scheme === SCHEME_FRAMED) {
      return strategies.framed;
    }
    if (encryptionMeta?.scheme === SCHEME_WHOLE) {
      return strategies.whole;
    }
    if (manifest.compression) {
      return strategies.compressed;
    }
    return strategies.plain;
  }
}
