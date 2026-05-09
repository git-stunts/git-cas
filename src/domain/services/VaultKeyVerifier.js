import CasError from '../errors/CasError.js';
import { decodeBase64, encodeBase64 } from '../encoding/base64.js';
import { utf8Encode } from '../encoding/utf8.js';
import { ErrorCodes } from '../errors/index.js';

export const VAULT_VERIFIER_PLAINTEXT = utf8Encode('git-cas-vault-verifier-v1');
export const VAULT_VERIFIER_AAD = utf8Encode('git-cas-vault-verifier-metadata-v1');

/**
 * Creates and verifies encrypted vault-key verifier metadata.
 */
export default class VaultKeyVerifier {
  /**
   * @param {object} options
   * @param {import('../../ports/CryptoPort.js').default} options.crypto
   */
  constructor({ crypto }) {
    if (
      !crypto ||
      typeof crypto.encryptBuffer !== 'function' ||
      typeof crypto.decryptBuffer !== 'function'
    ) {
      throw new CasError(
        'VaultKeyVerifier requires a crypto port with encryptBuffer and decryptBuffer',
        ErrorCodes.VAULT_DEPENDENCY_INVALID,
      );
    }
    this.crypto = crypto;
    Object.freeze(this);
  }

  /**
   * @param {Uint8Array} encryptionKey
   * @returns {Promise<{ version: 1, ciphertext: string, meta: object }>}
   */
  async create(encryptionKey) {
    const { buf, meta } = await this.crypto.encryptBuffer(
      VAULT_VERIFIER_PLAINTEXT,
      encryptionKey,
      VAULT_VERIFIER_AAD,
    );
    return {
      version: 1,
      ciphertext: encodeBase64(buf),
      meta,
    };
  }

  /**
   * @param {object} metadata
   * @param {Uint8Array} encryptionKey
   * @returns {Promise<boolean>} True when verifier metadata exists and passes.
   */
  async verify(metadata, encryptionKey) {
    const verifier = metadata.encryption?.verifier;
    if (!verifier) {
      return false;
    }

    let plaintext;
    try {
      plaintext = await this.crypto.decryptBuffer(
        decodeBase64(verifier.ciphertext),
        encryptionKey,
        verifier.meta,
        VAULT_VERIFIER_AAD,
      );
    } catch (err) {
      throw new CasError(
        'Vault passphrase verification failed',
        ErrorCodes.INTEGRITY_ERROR,
        { originalError: err, verifier: 'vault-metadata' },
      );
    }

    if (!constantTimeBytesEqual(plaintext, VAULT_VERIFIER_PLAINTEXT)) {
      throw new CasError(
        'Vault passphrase verification failed',
        ErrorCodes.INTEGRITY_ERROR,
        { verifier: 'vault-metadata', reason: 'plaintext-mismatch' },
      );
    }
    return true;
  }
}

/**
 * Constant-time byte comparison for verifier plaintext.
 *
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {boolean}
 */
function constantTimeBytesEqual(a, b) {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}
