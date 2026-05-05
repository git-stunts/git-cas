import CasError from '../errors/CasError.js';
import {
  SCHEME_CONVERGENT,
  SCHEME_FRAMED,
  SCHEME_WHOLE,
} from '../encryption/schemes.js';

/**
 * Immutable validated encryption metadata for a manifest.
 */
export default class EncryptionMetadata {
  /**
   * @param {object} fields
   */
  constructor(fields) {
    Object.assign(this, fields);
    Object.freeze(this);
  }

  /**
   * @param {{ slug?: string, encryption?: object }} manifest
   * @returns {EncryptionMetadata|undefined}
   */
  static fromManifest(manifest) {
    const meta = manifest.encryption;
    if (!meta) {
      return undefined;
    }
    EncryptionMetadata.#validateCommon(manifest, meta);

    if (meta.scheme === SCHEME_WHOLE) {
      return EncryptionMetadata.#whole(manifest, meta);
    }
    if (meta.scheme === SCHEME_FRAMED) {
      return EncryptionMetadata.#framed(manifest, meta);
    }
    if (meta.scheme === SCHEME_CONVERGENT) {
      return new EncryptionMetadata({ ...meta, scheme: SCHEME_CONVERGENT });
    }

    throw new CasError(
      `Encrypted manifest uses unknown scheme: ${meta.scheme}`,
      'INTEGRITY_ERROR',
      { slug: manifest.slug, reason: 'manifest-encryption-scheme', scheme: meta.scheme },
    );
  }

  static #validateCommon(manifest, meta) {
    if (meta.encrypted !== true) {
      throw new CasError(
        'Encrypted manifest metadata was downgraded or is invalid',
        'INTEGRITY_ERROR',
        { slug: manifest.slug, reason: 'manifest-encryption-downgrade' },
      );
    }
    if (meta.algorithm !== 'aes-256-gcm') {
      throw new CasError(
        `Encrypted manifest uses unexpected algorithm: ${meta.algorithm}`,
        'INTEGRITY_ERROR',
        { slug: manifest.slug, reason: 'manifest-encryption-algorithm', algorithm: meta.algorithm },
      );
    }
  }

  static #whole(manifest, meta) {
    if (typeof meta.nonce !== 'string' || meta.nonce.length === 0 || typeof meta.tag !== 'string' || meta.tag.length === 0) {
      throw new CasError(
        'Whole encrypted manifest is missing nonce/tag metadata',
        'INTEGRITY_ERROR',
        { slug: manifest.slug, reason: 'manifest-encryption-meta' },
      );
    }
    return new EncryptionMetadata({ ...meta, scheme: SCHEME_WHOLE });
  }

  static #framed(manifest, meta) {
    if (!Number.isInteger(meta.frameBytes) || meta.frameBytes < 1) {
      throw new CasError(
        'Framed encrypted manifest is missing a valid frameBytes value',
        'INTEGRITY_ERROR',
        { slug: manifest.slug, reason: 'manifest-encryption-frame-bytes', frameBytes: meta.frameBytes },
      );
    }
    return new EncryptionMetadata({ ...meta, scheme: SCHEME_FRAMED, frameBytes: meta.frameBytes });
  }
}
