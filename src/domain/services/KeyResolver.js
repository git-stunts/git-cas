/**
 * @fileoverview Key resolution service extracted from CasService.
 *
 * Handles all key-related logic: validation, wrapping/unwrapping DEKs,
 * resolving encryption keys from passphrases, and envelope recipient management.
 */
import CasError from '../errors/CasError.js';
import { prepareKdfOptions, prepareStoredKdfOptions } from '../../helpers/kdfPolicy.js';

/**
 * Resolves encryption keys for store and restore operations.
 *
 * Encapsulates the key resolution responsibility that was previously
 * spread across ~170 lines of CasService. Receives a CryptoPort via
 * constructor injection.
 *
 * **Design note:** KeyResolver calls `CryptoPort.deriveKey()` directly
 * rather than going through `CasService.deriveKey()`. If CasService ever
 * adds validation or observability around its `deriveKey()` wrapper,
 * KeyResolver will need updating to route through the service instead.
 */
export default class KeyResolver {
  /** @type {import('../../ports/CryptoPort.js').default} */
  #crypto;

  /**
   * @param {import('../../ports/CryptoPort.js').default} crypto - CryptoPort adapter.
   */
  constructor(crypto) {
    this.#crypto = crypto;
  }

  /**
   * Validates that passphrase and encryptionKey are not both provided.
   * @param {Buffer} [encryptionKey]
   * @param {string} [passphrase]
   * @throws {CasError} INVALID_OPTIONS if both are provided.
   */
  static validateKeySourceExclusive(encryptionKey, passphrase) {
    if (passphrase && encryptionKey) {
      throw new CasError(
        'Provide either encryptionKey or passphrase, not both',
        'INVALID_OPTIONS',
      );
    }
  }

  /**
   * Wraps a DEK with a KEK using AES-256-GCM.
   * @param {Buffer} dek - 32-byte data encryption key.
   * @param {Buffer} kek - 32-byte key encryption key.
   * @returns {Promise<{ wrappedDek: string, nonce: string, tag: string }>}
   */
  async wrapDek(dek, kek) {
    const { buf, meta } = await this.#crypto.encryptBuffer(dek, kek);
    return {
      wrappedDek: buf.toString('base64'),
      nonce: meta.nonce,
      tag: meta.tag,
    };
  }

  /**
   * Unwraps a DEK from a recipient entry using the given KEK.
   * @param {{ wrappedDek: string, nonce: string, tag: string }} recipientEntry
   * @param {Buffer} kek - 32-byte key encryption key.
   * @returns {Promise<Buffer>} The unwrapped DEK.
   * @throws {CasError} DEK_UNWRAP_FAILED if decryption fails.
   */
  async unwrapDek(recipientEntry, kek) {
    try {
      const ciphertext = Buffer.from(recipientEntry.wrappedDek, 'base64');
      const meta = {
        algorithm: 'aes-256-gcm',
        nonce: recipientEntry.nonce,
        tag: recipientEntry.tag,
        encrypted: true,
      };
      return await this.#crypto.decryptBuffer(ciphertext, kek, meta);
    } catch (err) {
      if (err instanceof CasError && err.code === 'DEK_UNWRAP_FAILED') { throw err; }
      throw new CasError(
        'Failed to unwrap DEK: authentication failed',
        'DEK_UNWRAP_FAILED',
        { originalError: err },
      );
    }
  }

  /**
   * Resolves the decryption key from a manifest, handling both legacy and
   * envelope (multi-recipient) encrypted manifests.
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @param {Buffer} [encryptionKey]
   * @param {string} [passphrase]
   * @returns {Promise<Buffer|undefined>}
   */
  async resolveForDecryption(manifest, encryptionKey, passphrase) {
    KeyResolver.validateKeySourceExclusive(encryptionKey, passphrase);

    const key = passphrase
      ? await this.#resolvePassphraseForDecryption(manifest, passphrase)
      : encryptionKey;

    if (!key) {
      if (manifest.encryption?.encrypted) {
        throw new CasError('Encryption key required to restore encrypted content', 'MISSING_KEY');
      }
      return undefined;
    }

    this.#crypto._validateKey(key);
    return await this.resolveKeyForRecipients(manifest, key);
  }

  /**
   * Resolves encryptionKey/passphrase into a key and optional KDF params for store().
   * @param {Buffer} [encryptionKey]
   * @param {string} [passphrase]
   * @param {Object} [kdfOptions] - KDF options when using passphrase.
   * @returns {Promise<{ key: Buffer|undefined, encExtra: Object }>}
   */
  async resolveForStore(encryptionKey, passphrase, kdfOptions) {
    let kdfParams;
    if (passphrase) {
      const options = prepareKdfOptions(kdfOptions, { source: 'store' });
      const derived = await this.#crypto.deriveKey({ passphrase, ...options });
      encryptionKey = derived.key;
      kdfParams = derived.params;
    }
    if (encryptionKey) { this.#crypto._validateKey(encryptionKey); }
    return { key: encryptionKey, encExtra: kdfParams ? { kdf: kdfParams } : {} };
  }

  /**
   * Resolves envelope recipients into a DEK and wrapped entries for store().
   * @param {Array<{label: string, key: Buffer}>} recipients
   * @returns {Promise<{ key: Buffer, encExtra: { recipients: Array } }>}
   * @throws {CasError} INVALID_OPTIONS if recipients is empty, non-array, or has duplicate labels.
   */
  async resolveRecipients(recipients) {
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw new CasError('At least one recipient is required', 'INVALID_OPTIONS');
    }
    const labels = recipients.map((r) => r.label);
    if (new Set(labels).size !== labels.length) {
      throw new CasError('Duplicate recipient labels are not allowed', 'INVALID_OPTIONS');
    }
    const dek = this.#crypto.randomBytes(32);
    const entries = [];
    for (const r of recipients) {
      this.#crypto._validateKey(r.key);
      entries.push({ label: r.label, ...(await this.wrapDek(dek, r.key)) });
    }
    return { key: dek, encExtra: { recipients: entries } };
  }

  /**
   * If manifest uses envelope encryption, unwraps the DEK. Otherwise returns key directly.
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @param {Buffer} key
   * @returns {Promise<Buffer>}
   * @throws {CasError} NO_MATCHING_RECIPIENT if no recipient entry can be unwrapped.
   */
  async resolveKeyForRecipients(manifest, key) {
    const recipients = manifest.encryption?.recipients;
    if (!recipients || recipients.length === 0) {
      return key;
    }

    for (const entry of recipients) {
      try {
        return await this.unwrapDek(entry, key);
      } catch (err) {
        if (!(err instanceof CasError && err.code === 'DEK_UNWRAP_FAILED')) { throw err; }
        // Not this recipient's KEK, try next
      }
    }

    throw new CasError(
      'No recipient entry could be unwrapped with the provided key',
      'NO_MATCHING_RECIPIENT',
    );
  }

  /**
   * Resolves passphrase to a key for decryption.
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @param {string} passphrase
   * @returns {Promise<Buffer>}
   * @throws {CasError} MISSING_KEY if manifest has no KDF params.
   */
  async #resolvePassphraseForDecryption(manifest, passphrase) {
    if (!manifest.encryption?.kdf) {
      throw new CasError(
        'Manifest was not stored with passphrase-based encryption; provide encryptionKey instead',
        'MISSING_KEY',
      );
    }
    return this.#resolveKeyFromPassphrase(passphrase, manifest.encryption.kdf);
  }

  /**
   * Derives a key from a passphrase using stored KDF params.
   * @param {string} passphrase
   * @param {Object} kdf - KDF params from manifest.encryption.kdf.
   * @returns {Promise<Buffer>}
   */
  async #resolveKeyFromPassphrase(passphrase, kdf) {
    const params = prepareStoredKdfOptions(kdf, { source: 'manifest' });
    const { key } = await this.#crypto.deriveKey({
      passphrase,
      salt: Buffer.from(kdf.salt, 'base64'),
      ...params,
    });
    return key;
  }
}
