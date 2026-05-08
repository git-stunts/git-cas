import CasError from '../errors/CasError.js';
import { encodeHex } from '../encoding/hex.js';
import { utf8Decode, utf8Encode } from '../encoding/utf8.js';
import Slug from '../value-objects/Slug.js';

export const PRIVACY_DERIVATION_LABEL = 'git-cas-privacy-v1';
const PRIVACY_INDEX_HMAC_PATTERN = /^[0-9a-f]{64}$/u;

/**
 * Handles privacy-mode persisted names and encrypted slug indexes.
 */
export default class VaultPrivacyIndex {
  /**
   * @param {object} options
   * @param {import('../../ports/CryptoPort.js').default} options.crypto
   */
  constructor({ crypto }) {
    if (
      !crypto ||
      typeof crypto.hmacSha256 !== 'function' ||
      typeof crypto.encryptBuffer !== 'function' ||
      typeof crypto.decryptBuffer !== 'function'
    ) {
      throw new CasError(
        'VaultPrivacyIndex requires hmacSha256, encryptBuffer, and decryptBuffer crypto methods',
        'VAULT_DEPENDENCY_INVALID',
      );
    }
    this.crypto = crypto;
    Object.freeze(this);
  }

  /**
   * @param {object} options
   * @param {Uint8Array} options.encryptionKey
   * @param {string|Slug} options.slug
   * @returns {Promise<string>}
   */
  async persistedNameForSlug({ encryptionKey, slug }) {
    this.#requireEncryptionKey(encryptionKey);
    const privacyKey = await this.derivePrivacyKey(encryptionKey);
    return await this.hmacSlug(privacyKey, Slug.from(slug).toString());
  }

  /**
   * @param {Map<string, string>} entries
   * @param {Uint8Array} encryptionKey
   * @returns {Promise<{ persistedNameBySlug: Map<string, string>, slugToHmac: Map<string, string> }>}
   */
  async persistedNamesForEntries(entries, encryptionKey) {
    this.#requireEncryptionKey(encryptionKey);
    const privacyKey = await this.derivePrivacyKey(encryptionKey);
    const persistedNameBySlug = new Map();
    const slugToHmac = new Map();
    for (const slug of entries.keys()) {
      const vaultSlug = Slug.from(slug).toString();
      const hmacName = await this.hmacSlug(privacyKey, vaultSlug);
      persistedNameBySlug.set(vaultSlug, hmacName);
      slugToHmac.set(vaultSlug, hmacName);
    }
    return { persistedNameBySlug, slugToHmac };
  }

  /**
   * @param {Uint8Array} encryptionKey
   * @returns {Promise<Uint8Array>}
   */
  async derivePrivacyKey(encryptionKey) {
    this.#requireEncryptionKey(encryptionKey);
    return await Promise.resolve(
      this.crypto.hmacSha256(encryptionKey, utf8Encode(PRIVACY_DERIVATION_LABEL)),
    );
  }

  /**
   * @param {Uint8Array} privacyKey
   * @param {string} slug
   * @returns {Promise<string>}
   */
  async hmacSlug(privacyKey, slug) {
    return encodeHex(await Promise.resolve(this.crypto.hmacSha256(privacyKey, utf8Encode(slug))));
  }

  /**
   * @param {object} options
   * @param {Map<string, string>} options.slugToHmac
   * @param {Uint8Array} options.encryptionKey
   * @returns {Promise<{ bytes: Uint8Array, meta: object }>}
   */
  async encryptIndex({ slugToHmac, encryptionKey }) {
    this.#requireEncryptionKey(encryptionKey);
    const json = JSON.stringify(Object.fromEntries(slugToHmac));
    const { buf, meta } = await this.crypto.encryptBuffer(utf8Encode(json), encryptionKey);
    return { bytes: buf, meta };
  }

  /**
   * @param {object} options
   * @param {Uint8Array} options.bytes
   * @param {Uint8Array} options.encryptionKey
   * @param {object} options.meta
   * @returns {Promise<Map<string, string>>}
   */
  async decryptIndex({ bytes, encryptionKey, meta }) {
    this.#requireEncryptionKey(encryptionKey);
    try {
      const plaintext = await this.crypto.decryptBuffer(bytes, encryptionKey, meta);
      return this.#decodeIndexPayload(JSON.parse(utf8Decode(plaintext)));
    } catch (err) {
      if (err instanceof CasError) {
        throw err;
      }
      throw new CasError(
        'Failed to decrypt vault privacy index',
        'VAULT_PRIVACY_INDEX_INVALID',
        { originalError: err },
      );
    }
  }

  /**
   * @param {unknown} payload
   * @returns {Map<string, string>}
   */
  #decodeIndexPayload(payload) {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new CasError(
        'Vault privacy index payload must be a slug-to-HMAC object',
        'VAULT_PRIVACY_INDEX_INVALID',
        { field: 'root' },
      );
    }
    return this.#validatedIndexEntries(/** @type {Record<string, unknown>} */ (payload));
  }

  /**
   * @param {Record<string, unknown>} payload
   * @returns {Map<string, string>}
   */
  #validatedIndexEntries(payload) {
    const entries = new Map();
    for (const [slug, persistedName] of Object.entries(payload)) {
      entries.set(this.#validatedSlug(slug), this.#validatedPersistedName(persistedName));
    }
    return entries;
  }

  /**
   * @param {string} slug
   * @returns {string}
   */
  #validatedSlug(slug) {
    try {
      return Slug.from(slug).toString();
    } catch (err) {
      throw new CasError(
        'Vault privacy index slug is invalid',
        'VAULT_PRIVACY_INDEX_INVALID',
        { field: 'slug', slug, originalError: err },
      );
    }
  }

  /**
   * @param {unknown} persistedName
   * @returns {string}
   */
  #validatedPersistedName(persistedName) {
    if (typeof persistedName !== 'string' || !PRIVACY_INDEX_HMAC_PATTERN.test(persistedName)) {
      throw new CasError(
        'Vault privacy index persisted name is invalid',
        'VAULT_PRIVACY_INDEX_INVALID',
        { field: 'persistedName', persistedName },
      );
    }
    return persistedName;
  }

  /**
   * @param {Uint8Array|undefined} encryptionKey
   */
  #requireEncryptionKey(encryptionKey) {
    if (!encryptionKey) {
      throw new CasError(
        'Privacy mode is enabled - encryption key is required to read vault state',
        'VAULT_PRIVACY_KEY_REQUIRED',
      );
    }
  }
}
