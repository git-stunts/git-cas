import Manifest from '../value-objects/Manifest.js';
import CasError from '../errors/CasError.js';
import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';

/**
 * Envelope recipient mutation boundary.
 */
export default class RecipientService {
  #crypto;
  #keyResolver;

  /**
   * @param {Object} options
   * @param {import('../../ports/CryptoPort.js').default} options.crypto
   * @param {import('./KeyResolver.js').default} options.keyResolver
   */
  constructor({ crypto, keyResolver }) {
    this.#crypto = crypto;
    this.#keyResolver = keyResolver;
  }

  /**
   * @param {{ manifest: Manifest, existingKey: Uint8Array, newRecipientKey: Uint8Array, label: string }} options
   * @returns {Promise<Manifest>}
   */
  async addRecipient({ manifest, existingKey, newRecipientKey, label }) {
    const recipients = this.#requireRecipients(manifest);
    if (recipients.some((recipient) => recipient.label === label)) {
      throw createCasError(`Recipient "${label}" already exists`, ErrorCodes.RECIPIENT_ALREADY_EXISTS, { label });
    }

    this.#crypto._validateKey(existingKey);
    this.#crypto._validateKey(newRecipientKey);

    let dek;
    try {
      dek = await this.#keyResolver.resolveKeyForRecipients(manifest, existingKey);
    } catch (err) {
      if (err instanceof CasError && err.code === ErrorCodes.NO_MATCHING_RECIPIENT) {
        throw createCasError('Failed to unwrap DEK: authentication failed', ErrorCodes.DEK_UNWRAP_FAILED, { originalError: err });
      }
      throw err;
    }

    const newEntry = { label, ...(await this.#keyResolver.wrapDek(dek, newRecipientKey)) };
    const json = manifest.toJSON();
    const updatedEncryption = {
      ...json.encryption,
      recipients: [...recipients.map((recipient) => ({ ...recipient })), newEntry],
    };

    return new Manifest({ ...json, encryption: updatedEncryption });
  }

  /**
   * @param {{ manifest: Manifest, label: string }} options
   * @returns {Promise<Manifest>}
   */
  async removeRecipient({ manifest, label }) {
    const recipients = this.#requireRecipients(manifest);
    if (!recipients.some((recipient) => recipient.label === label)) {
      throw createCasError(`Recipient "${label}" not found`, ErrorCodes.RECIPIENT_NOT_FOUND, { label });
    }
    if (recipients.length === 1) {
      throw createCasError('Cannot remove the last recipient', ErrorCodes.CANNOT_REMOVE_LAST_RECIPIENT);
    }

    const filtered = recipients.filter((recipient) => recipient.label !== label).map((recipient) => ({ ...recipient }));
    if (filtered.length === 0) {
      throw createCasError('Cannot remove the last recipient', ErrorCodes.CANNOT_REMOVE_LAST_RECIPIENT);
    }
    const json = manifest.toJSON();
    return new Manifest({ ...json, encryption: { ...json.encryption, recipients: filtered } });
  }

  /**
   * @param {Manifest} manifest
   * @returns {string[]}
   */
  listRecipients(manifest) {
    return (manifest.encryption?.recipients || []).map((recipient) => recipient.label);
  }

  /**
   * @param {{ manifest: Manifest, oldKey: Uint8Array, newKey: Uint8Array, label?: string }} options
   * @returns {Promise<Manifest>}
   */
  async rotateKey({ manifest, oldKey, newKey, label }) {
    const recipients = manifest.encryption?.recipients;
    if (!recipients || recipients.length === 0) {
      throw createCasError('Key rotation requires envelope encryption (recipients)', ErrorCodes.ROTATION_NOT_SUPPORTED);
    }

    this.#crypto._validateKey(oldKey);
    this.#crypto._validateKey(newKey);

    const { matchIndex, dek } = label
      ? await this.#findRecipientByLabel(recipients, label, oldKey)
      : await this.#findRecipientByKey(recipients, oldKey);

    return this.#buildRotatedManifest({ manifest, recipients, matchIndex, dek, newKey });
  }

  #requireRecipients(manifest) {
    const recipients = manifest.encryption?.recipients;
    if (!recipients || recipients.length === 0) {
      throw createCasError('Manifest does not use envelope encryption (no recipients)', ErrorCodes.INVALID_OPTIONS);
    }
    return recipients;
  }

  async #findRecipientByLabel(recipients, label, oldKey) {
    const matchIndex = recipients.findIndex((recipient) => recipient.label === label);
    if (matchIndex === -1) {
      throw createCasError(`Recipient "${label}" not found`, ErrorCodes.RECIPIENT_NOT_FOUND, { label });
    }
    const dek = await this.#keyResolver.unwrapDek(recipients[matchIndex], oldKey);
    return { matchIndex, dek };
  }

  async #findRecipientByKey(recipients, oldKey) {
    let match = null;
    for (let index = 0; index < recipients.length; index++) {
      try {
        const dek = await this.#keyResolver.unwrapDek(recipients[index], oldKey);
        match ??= { matchIndex: index, dek };
      } catch (err) {
        if (!(err instanceof CasError && err.code === ErrorCodes.DEK_UNWRAP_FAILED)) {
          throw err;
        }
      }
    }
    if (match) {
      return match;
    }
    throw createCasError('No recipient entry could be unwrapped with the provided key', ErrorCodes.NO_MATCHING_RECIPIENT);
  }

  async #buildRotatedManifest({ manifest, recipients, matchIndex, dek, newKey }) {
    const newWrapped = await this.#keyResolver.wrapDek(dek, newKey);
    const manifestKeyVersion = (manifest.encryption.keyVersion || 0) + 1;
    const recipientKeyVersion = (recipients[matchIndex].keyVersion || 0) + 1;
    const json = manifest.toJSON();
    const updatedRecipients = recipients.map((recipient, index) => {
      if (index === matchIndex) {
        return { ...recipient, ...newWrapped, keyVersion: recipientKeyVersion };
      }
      return { ...recipient };
    });

    return new Manifest({
      ...json,
      encryption: { ...json.encryption, recipients: updatedRecipients, keyVersion: manifestKeyVersion },
    });
  }
}
