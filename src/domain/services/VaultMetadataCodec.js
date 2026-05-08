import CasError from '../errors/CasError.js';
import { utf8Decode, utf8Encode } from '../encoding/utf8.js';
import { decodeBase64 } from '../encoding/base64.js';
import validateAesGcmMeta from '../../helpers/aesGcmMeta.js';
import { prepareStoredKdfOptions } from '../../helpers/kdfPolicy.js';

export const VAULT_METADATA_VERSION = 1;
export const VAULT_ENCRYPTION_COUNT_WARN = 2 ** 31;
export const VAULT_ENCRYPTION_COUNT_MAX = 2 ** 32 - 1;

/**
 * Pure codec for the persisted `.vault.json` boundary format.
 */
export default class VaultMetadataCodec {
  /**
   * @param {object} [options]
   * @param {number} [options.maxEncryptionCount]
   */
  constructor({ maxEncryptionCount = VAULT_ENCRYPTION_COUNT_MAX } = {}) {
    if (!Number.isSafeInteger(maxEncryptionCount) || maxEncryptionCount < 0) {
      throw new CasError(
        'Vault metadata codec maxEncryptionCount must be a non-negative safe integer',
        'VAULT_DEPENDENCY_INVALID',
        { maxEncryptionCount },
      );
    }
    this.maxEncryptionCount = maxEncryptionCount;
    Object.freeze(this);
  }

  /**
   * @param {object} metadata
   * @returns {Uint8Array}
   */
  encode(metadata) {
    this.validate(metadata);
    return utf8Encode(JSON.stringify(metadata, null, 2));
  }

  /**
   * @param {Uint8Array} bytes
   * @returns {object}
   */
  decode(bytes) {
    try {
      const metadata = JSON.parse(utf8Decode(bytes));
      this.validate(metadata);
      return metadata;
    } catch (err) {
      if (err instanceof CasError) {
        throw err;
      }
      throw new CasError(
        `Failed to parse .vault.json: ${/** @type {Error} */ (err).message}`,
        'VAULT_METADATA_INVALID',
        { originalError: err },
      );
    }
  }

  /**
   * @param {object} metadata
   */
  validate(metadata) {
    if (typeof metadata !== 'object' || metadata === null) {
      throw new CasError('Vault metadata must be an object', 'VAULT_METADATA_INVALID', { metadata });
    }
    if (metadata.version !== VAULT_METADATA_VERSION) {
      throw new CasError(
        `Unsupported vault metadata version: ${metadata.version}`,
        'VAULT_METADATA_INVALID',
        { metadata },
      );
    }
    if (metadata.encryption) {
      this.#validateEncryption(metadata.encryption, metadata);
    }
    this.#validateEncryptionCount(metadata);
  }

  /**
   * @param {object} encryption
   * @param {object} metadata
   */
  #validateEncryption(encryption, metadata) {
    const { cipher, kdf } = encryption;
    if (!cipher || !kdf?.algorithm || !kdf?.salt || !kdf?.keyLength) {
      throw new CasError(
        'Vault encryption metadata missing required fields',
        'VAULT_METADATA_INVALID',
        { metadata },
      );
    }
    this.#validateStoredKdf(kdf, metadata);
    if (encryption.verifier !== undefined) {
      this.#validateVerifier(encryption.verifier, metadata);
    }
  }

  /**
   * @param {object} verifier
   * @param {object} metadata
   */
  #validateVerifier(verifier, metadata) {
    const invalid = (
      typeof verifier !== 'object' ||
      verifier === null ||
      verifier.version !== 1 ||
      typeof verifier.ciphertext !== 'string' ||
      typeof verifier.meta !== 'object' ||
      verifier.meta === null
    );
    if (invalid) {
      throw new CasError(
        'Vault encryption verifier metadata missing required fields',
        'VAULT_METADATA_INVALID',
        { metadata, field: 'encryption.verifier' },
      );
    }

    try {
      decodeBase64(verifier.ciphertext);
      validateAesGcmMeta(verifier.meta);
    } catch (err) {
      throw new CasError(
        `Vault encryption verifier metadata invalid: ${/** @type {Error} */ (err).message}`,
        'VAULT_METADATA_INVALID',
        { metadata, field: 'encryption.verifier', originalError: err },
      );
    }
  }

  /**
   * @param {object} kdf
   * @param {object} metadata
   */
  #validateStoredKdf(kdf, metadata) {
    try {
      prepareStoredKdfOptions(kdf, { source: 'vault-metadata' });
    } catch (err) {
      if (!(err instanceof CasError) || err.code !== 'KDF_POLICY_VIOLATION') {
        throw err;
      }
      throw new CasError(
        `Vault encryption metadata invalid: ${err.message}`,
        'VAULT_METADATA_INVALID',
        { metadata, originalError: err },
      );
    }
  }

  /**
   * @param {object} metadata
   */
  #validateEncryptionCount(metadata) {
    if (metadata.encryptionCount === undefined) {
      return;
    }
    if (
      !Number.isSafeInteger(metadata.encryptionCount) ||
      metadata.encryptionCount < 0 ||
      metadata.encryptionCount > this.maxEncryptionCount
    ) {
      throw new CasError(
        `Vault encryptionCount metadata must be a non-negative safe integer no greater than ${this.maxEncryptionCount}`,
        'VAULT_METADATA_INVALID',
        {
          metadata,
          field: 'encryptionCount',
          value: metadata.encryptionCount,
          maxEncryptionCount: this.maxEncryptionCount,
        },
      );
    }
  }
}
