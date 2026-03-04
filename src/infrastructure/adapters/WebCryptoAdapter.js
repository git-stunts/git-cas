import CryptoPort from '../../ports/CryptoPort.js';
import CasError from '../../domain/errors/CasError.js';

/**
 * {@link CryptoPort} implementation using the Web Crypto API.
 *
 * Works in Deno, browsers, and other environments supporting `globalThis.crypto.subtle`.
 * Note: streaming encryption buffers all data internally because Web Crypto's
 * AES-GCM is a one-shot API (the GCM tag is computed over the entire plaintext).
 */
export default class WebCryptoAdapter extends CryptoPort {
  /**
   * @override
   * @param {Buffer|Uint8Array} buf - Data to hash.
   * @returns {Promise<string>} 64-char hex digest.
   */
  async sha256(buf) {
    // @ts-ignore -- Buffer satisfies BufferSource at runtime; TS strictness mismatch
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * @override
   * @param {number} n - Number of random bytes.
   * @returns {Buffer|Uint8Array}
   */
  randomBytes(n) {
    const uint8 = globalThis.crypto.getRandomValues(new Uint8Array(n));
    if (globalThis.Buffer) {
      return Buffer.from(uint8.buffer, uint8.byteOffset, uint8.byteLength);
    }
    return uint8;
  }

  /**
   * @override
   * @param {Buffer|Uint8Array} buffer - Plaintext to encrypt.
   * @param {Buffer|Uint8Array} key - 32-byte encryption key.
   * @returns {Promise<{ buf: Buffer, meta: import('../../ports/CryptoPort.js').EncryptionMeta }>}
   */
  async encryptBuffer(buffer, key) {
    this._validateKey(key);
    const nonce = this.randomBytes(12);
    const cryptoKey = await this.#importKey(key);

    // AES-GCM in Web Crypto includes the tag at the end of the ciphertext
    const encrypted = await globalThis.crypto.subtle.encrypt(
      // @ts-ignore -- Uint8Array satisfies BufferSource at runtime
      { name: 'AES-GCM', iv: /** @type {Uint8Array} */ (nonce) },
      cryptoKey,
      buffer
    );

    const fullBuffer = new Uint8Array(encrypted);
    const tagLength = 16;
    const ciphertext = fullBuffer.slice(0, -tagLength);
    const tag = fullBuffer.slice(-tagLength);

    return {
      buf: Buffer.from(ciphertext),
      meta: this._buildMeta(this.#toBase64(nonce), this.#toBase64(tag)),
    };
  }

  /**
   * @override
   * @param {Buffer|Uint8Array} buffer - Ciphertext to decrypt.
   * @param {Buffer|Uint8Array} key - 32-byte encryption key.
   * @param {import('../../ports/CryptoPort.js').EncryptionMeta} meta - Encryption metadata.
   * @returns {Promise<Buffer>}
   */
  async decryptBuffer(buffer, key, meta) {
    this._validateKey(key);
    const nonce = this.#fromBase64(meta.nonce);
    const tag = this.#fromBase64(meta.tag);
    const cryptoKey = await this.#importKey(key);

    // Reconstruct Web Crypto format (ciphertext + tag)
    const combined = new Uint8Array(buffer.length + tag.length);
    combined.set(new Uint8Array(buffer));
    combined.set(tag, buffer.length);

    try {
      const decrypted = await globalThis.crypto.subtle.decrypt(
        // @ts-ignore -- Uint8Array satisfies BufferSource at runtime
        { name: 'AES-GCM', iv: /** @type {Uint8Array} */ (nonce) },
        cryptoKey,
        combined
      );
      return Buffer.from(decrypted);
    } catch (err) {
      throw new CasError('Decryption failed', 'INTEGRITY_ERROR', { originalError: err });
    }
  }

  /**
   * @override
   * @param {Buffer|Uint8Array} key - 32-byte encryption key.
   * @returns {{ encrypt: (source: AsyncIterable<Buffer>) => AsyncIterable<Buffer>, finalize: () => import('../../ports/CryptoPort.js').EncryptionMeta }}
   */
  createEncryptionStream(key) {
    this._validateKey(key);
    const nonce = this.randomBytes(12);
    const cryptoKeyPromise = this.#importKey(key);

    // Web Crypto buffers all data for the one-shot AES-GCM call (GCM tag spans the whole plaintext).
    /** @type {Buffer[]} */
    const chunks = [];
    /** @type {Uint8Array|null} */
    let finalTag = null;
    let streamConsumed = false;

    /** @param {AsyncIterable<Buffer>} source */
    const encrypt = async function* (source) {
      for await (const chunk of source) {
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);
      const cryptoKey = await cryptoKeyPromise;
      const encrypted = await globalThis.crypto.subtle.encrypt(
        // @ts-ignore -- Uint8Array satisfies BufferSource at runtime
        { name: 'AES-GCM', iv: /** @type {Uint8Array} */ (nonce) },
        cryptoKey,
        buffer
      );

      const fullBuffer = new Uint8Array(encrypted);
      const tagLength = 16;
      const ciphertext = fullBuffer.slice(0, -tagLength);
      finalTag = fullBuffer.slice(-tagLength);
      streamConsumed = true;

      yield Buffer.from(ciphertext);
    };

    const finalize = () => {
      if (!streamConsumed) {
        throw new CasError(
          'Cannot finalize before the encrypt stream is fully consumed',
          'STREAM_NOT_CONSUMED',
        );
      }
      return this._buildMeta(this.#toBase64(nonce), this.#toBase64(/** @type {Uint8Array} */ (finalTag)));
    };

    return { encrypt, finalize };
  }

  /**
   * @override
   * @param {string} passphrase - The passphrase.
   * @param {Buffer|Uint8Array} saltBuf - Salt bytes.
   * @param {import('../../ports/CryptoPort.js').DeriveKeyParams} params - KDF parameters.
   * @returns {Promise<Buffer>}
   */
  async _doDeriveKey(passphrase, saltBuf, { algorithm, iterations, cost, blockSize, parallelization, keyLength }) {
    if (algorithm === 'pbkdf2') {
      return this.#derivePbkdf2(passphrase, saltBuf, { iterations, keyLength });
    }
    return this.#deriveScrypt(passphrase, saltBuf, { cost, blockSize, parallelization, keyLength });
  }

  /**
   * Derives a key using PBKDF2 via Web Crypto.
   * @param {string} passphrase - The passphrase.
   * @param {Buffer|Uint8Array} saltBuf - Salt bytes.
   * @param {{ iterations: number, keyLength: number }} params - PBKDF2 parameters.
   * @returns {Promise<Buffer>}
   */
  async #derivePbkdf2(passphrase, saltBuf, params) {
    const enc = new globalThis.TextEncoder();
    const baseKey = await globalThis.crypto.subtle.importKey(
      'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits'],
    );
    const bits = await globalThis.crypto.subtle.deriveBits(
      // @ts-ignore -- Uint8Array satisfies BufferSource at runtime
      { name: 'PBKDF2', salt: /** @type {Uint8Array} */ (saltBuf), iterations: params.iterations, hash: 'SHA-512' },
      baseKey, params.keyLength * 8,
    );
    return Buffer.from(bits);
  }

  /**
   * Derives a key using scrypt via Node's crypto module (fallback).
   * @param {string} passphrase - The passphrase.
   * @param {Buffer|Uint8Array} saltBuf - Salt bytes.
   * @param {{ cost: number, blockSize: number, parallelization: number, keyLength: number }} params - scrypt parameters.
   * @returns {Promise<Buffer>}
   */
  async #deriveScrypt(passphrase, saltBuf, params) {
    let scryptCb;
    let promisifyFn;
    try {
      ({ scrypt: scryptCb } = await import('node:crypto'));
      ({ promisify: promisifyFn } = await import('node:util'));
    } catch {
      throw new Error('scrypt KDF requires a Node.js-compatible runtime (node:crypto unavailable)');
    }
    // @ts-ignore -- promisify(scrypt) accepts options as 4th arg at runtime
    return promisifyFn(scryptCb)(passphrase, saltBuf, params.keyLength, {
      N: params.cost, r: params.blockSize, p: params.parallelization,
    });
  }

  /**
   * Imports a raw key for use with Web Crypto AES-GCM operations.
   * @param {Buffer|Uint8Array} rawKey - 32-byte raw key material.
   * @returns {Promise<CryptoKey>}
   */
  async #importKey(rawKey) {
    return globalThis.crypto.subtle.importKey(
      'raw',
      // @ts-ignore -- Buffer/Uint8Array satisfies BufferSource at runtime
      /** @type {Uint8Array} */ (rawKey),
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encodes binary data to base64, using Buffer when available.
   * @param {Buffer|Uint8Array} buf - Binary data to encode.
   * @returns {string}
   */
  #toBase64(buf) {
    if (globalThis.Buffer) {
      return Buffer.from(buf).toString('base64');
    }
    return globalThis.btoa(String.fromCharCode(...new Uint8Array(buf)));
  }

  /**
   * Decodes a base64 string to binary, using Buffer when available.
   * @param {string} str - Base64-encoded string.
   * @returns {Buffer|Uint8Array}
   */
  #fromBase64(str) {
    if (globalThis.Buffer) {
      return Buffer.from(str, 'base64');
    }
    return Uint8Array.from(globalThis.atob(str), c => c.charCodeAt(0));
  }
}
