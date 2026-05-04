import CryptoPort from '../../ports/CryptoPort.js';
import CasError from '../../domain/errors/CasError.js';
import validateAesGcmMeta from '../../helpers/aesGcmMeta.js';
import { concatBytes } from '../../domain/bytes/ByteLayout.js';
import { encodeBase64 } from '../../domain/encoding/base64.js';

/**
 * {@link CryptoPort} implementation using the Web Crypto API.
 *
 * Works in Deno, browsers, and other environments supporting `globalThis.crypto.subtle`.
 * Note: streaming encryption buffers all data internally because Web Crypto's
 * AES-GCM is a one-shot API (the GCM tag is computed over the entire plaintext).
 */
export default class WebCryptoAdapter extends CryptoPort {
  /** @type {number} */
  #maxEncryptionBufferSize;
  /** @type {number} */
  #maxDecryptionBufferSize;

  /**
   * @param {Object} [options]
   * @param {number} [options.maxEncryptionBufferSize=536870912] - Max bytes to buffer during streaming encryption (default 512 MiB).
   * @param {number} [options.maxDecryptionBufferSize=536870912] - Max bytes to buffer during streaming decryption (default 512 MiB).
   */
  constructor({
    maxEncryptionBufferSize = 512 * 1024 * 1024,
    maxDecryptionBufferSize = 512 * 1024 * 1024,
  } = {}) {
    super();
    if (!Number.isFinite(maxEncryptionBufferSize) || maxEncryptionBufferSize <= 0) {
      throw new RangeError('maxEncryptionBufferSize must be a finite positive number');
    }
    if (!Number.isFinite(maxDecryptionBufferSize) || maxDecryptionBufferSize <= 0) {
      throw new RangeError('maxDecryptionBufferSize must be a finite positive number');
    }
    this.#maxEncryptionBufferSize = maxEncryptionBufferSize;
    this.#maxDecryptionBufferSize = maxDecryptionBufferSize;
  }

  /**
   * @override
   * @param {Uint8Array} buf - Data to hash.
   * @returns {Promise<string>} 64-char hex digest.
   */
  async sha256(buf) {
    // @ts-ignore -- Uint8Array satisfies BufferSource at runtime; TS strictness mismatch
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * @override
   * @param {number} n - Number of random bytes.
   * @returns {Uint8Array}
   */
  randomBytes(n) {
    return globalThis.crypto.getRandomValues(new Uint8Array(n));
  }

  /**
   * @override
   * @param {Uint8Array} buffer - Plaintext to encrypt.
   * @param {Uint8Array} key - 32-byte encryption key.
   * @param {Uint8Array} [aad] - Optional additional authenticated data (AAD).
   * @returns {Promise<{ buf: Uint8Array, meta: import('../../ports/CryptoPort.js').EncryptionMeta }>}
   */
  async encryptBuffer(buffer, key, aad) {
    this._validateKey(key);
    const nonce = this.randomBytes(12);
    const cryptoKey = await this.#importKey(key);

    /** @type {AesGcmParams} */
    const algoParams = { name: 'AES-GCM', iv: /** @type {Uint8Array} */ (nonce) };
    if (aad) {
      algoParams.additionalData = aad;
    }

    // AES-GCM in Web Crypto includes the tag at the end of the ciphertext
    const encrypted = await globalThis.crypto.subtle.encrypt(
      // @ts-ignore -- Uint8Array satisfies BufferSource at runtime
      algoParams,
      cryptoKey,
      buffer
    );

    const fullBuffer = new Uint8Array(encrypted);
    const tagLength = 16;
    const ciphertext = fullBuffer.slice(0, -tagLength);
    const tag = fullBuffer.slice(-tagLength);

    return {
      buf: ciphertext,
      meta: this._buildMeta(encodeBase64(nonce), encodeBase64(tag)),
    };
  }

  /**
   * @override
   * @param {Uint8Array} buffer - Ciphertext to decrypt.
   * @param {Uint8Array} key - 32-byte encryption key.
   * @param {import('../../ports/CryptoPort.js').EncryptionMeta} meta - Encryption metadata.
   * @param {Uint8Array} [aad] - Optional additional authenticated data (AAD).
   * @returns {Promise<Uint8Array>}
   */
  async decryptBuffer(buffer, key, meta, aad) { // eslint-disable-line max-params
    this._validateKey(key);
    const { nonce, tag } = validateAesGcmMeta(meta);
    const cryptoKey = await this.#importKey(key);

    // Reconstruct Web Crypto format (ciphertext + tag)
    const combined = new Uint8Array(buffer.length + tag.length);
    combined.set(new Uint8Array(buffer));
    combined.set(tag, buffer.length);

    /** @type {AesGcmParams} */
    const algoParams = { name: 'AES-GCM', iv: /** @type {Uint8Array} */ (nonce) };
    if (aad) {
      algoParams.additionalData = aad;
    }

    try {
      const decrypted = await globalThis.crypto.subtle.decrypt(
        // @ts-ignore -- Uint8Array satisfies BufferSource at runtime
        algoParams,
        cryptoKey,
        combined
      );
      return new Uint8Array(decrypted);
    } catch (err) {
      throw new CasError('Decryption failed', 'INTEGRITY_ERROR', { originalError: err });
    }
  }

  /**
   * @override
   * @param {Uint8Array} key - 32-byte encryption key.
   * @param {Uint8Array} [aad] - Optional additional authenticated data (AAD).
   * @returns {{ encrypt: (source: AsyncIterable<Uint8Array>) => AsyncIterable<Uint8Array>, finalize: () => import('../../ports/CryptoPort.js').EncryptionMeta }}
   */
  createEncryptionStream(key, aad) {
    this._validateKey(key);
    const nonce = this.randomBytes(12);
    const cryptoKeyPromise = this.#importKey(key);
    const maxBuf = this.#maxEncryptionBufferSize;
    const state = { /** @type {Uint8Array|null} */ tag: null, consumed: false };

    const encrypt = WebCryptoAdapter.#makeEncryptGenerator({ cryptoKeyPromise, nonce, maxBuf, state, aad });

    const finalize = () => {
      if (!state.consumed) {
        throw new CasError('Cannot finalize before the encrypt stream is fully consumed', 'STREAM_NOT_CONSUMED');
      }
      return this._buildMeta(encodeBase64(nonce), encodeBase64(/** @type {Uint8Array} */ (state.tag)));
    };

    return { encrypt, finalize };
  }

  /**
   * @override
   * @param {Uint8Array} key - 32-byte encryption key.
   * @param {import('../../ports/CryptoPort.js').EncryptionMeta} meta - Encryption metadata.
   * @param {Uint8Array} [aad] - Optional additional authenticated data (AAD).
   * @returns {{ decrypt: (source: AsyncIterable<Uint8Array>) => AsyncIterable<Uint8Array> }}
   */
  createDecryptionStream(key, meta, aad) {
    this._validateKey(key);
    validateAesGcmMeta(meta);
    const maxBuf = this.#maxDecryptionBufferSize;

    return {
      decrypt: async function* (source) {
        /** @type {Uint8Array[]} */
        const chunks = [];
        let accumulatedBytes = 0;
        for await (const chunk of source) {
          accumulatedBytes += chunk.length;
          if (accumulatedBytes > maxBuf) {
            throw new CasError(
              `Streaming decryption buffered ${accumulatedBytes} bytes (limit: ${maxBuf}). ` +
              'Web Crypto AES-GCM decrypt is one-shot. Use Node.js/Bun or framed encryption for large encrypted restores.',
              'DECRYPTION_BUFFER_EXCEEDED',
              { accumulated: accumulatedBytes, limit: maxBuf },
            );
          }
          chunks.push(chunk);
        }
        yield await this.decryptBuffer(concatBytes(chunks, accumulatedBytes), key, meta, aad);
      }.bind(this),
    };
  }

  /**
   * Builds the encrypt async generator for createEncryptionStream.
   *
   * A static method is used (rather than closures) because `async function*`
   * cannot be an arrow function — `this` binding would be lost. The `state`
   * object bridges mutable data between the generator and `finalize()`.
   *
   * @param {{ cryptoKeyPromise: Promise<CryptoKey>, nonce: Uint8Array, maxBuf: number, state: { tag: Uint8Array|null, consumed: boolean }, aad?: Uint8Array }} ctx
   * @returns {(source: AsyncIterable<Uint8Array>) => AsyncGenerator<Uint8Array>}
   */
  static #makeEncryptGenerator({ cryptoKeyPromise, nonce, maxBuf, state, aad }) {
    return async function* (source) {
      /** @type {Uint8Array[]} */
      const chunks = [];
      let accumulatedBytes = 0;
      for await (const chunk of source) {
        accumulatedBytes += chunk.length;
        if (accumulatedBytes > maxBuf) {
          throw new CasError(
            `Streaming encryption buffered ${accumulatedBytes} bytes (limit: ${maxBuf}). ` +
            'Web Crypto AES-GCM buffers all data. Use Node.js/Bun or store without encryption for large files.',
            'ENCRYPTION_BUFFER_EXCEEDED',
            { accumulated: accumulatedBytes, limit: maxBuf },
          );
        }
        chunks.push(chunk);
      }
      const buffer = concatBytes(chunks, accumulatedBytes);
      const cryptoKey = await cryptoKeyPromise;
      /** @type {AesGcmParams} */
      const algoParams = { name: 'AES-GCM', iv: /** @type {Uint8Array} */ (nonce) };
      if (aad) {
        algoParams.additionalData = aad;
      }
      const encrypted = await globalThis.crypto.subtle.encrypt(
        // @ts-ignore -- Uint8Array satisfies BufferSource at runtime
        algoParams,
        cryptoKey, buffer,
      );
      const fullBuffer = new Uint8Array(encrypted);
      const tagLength = 16;
      state.tag = fullBuffer.slice(-tagLength);
      state.consumed = true;
      yield fullBuffer.slice(0, -tagLength);
    };
  }

  /**
   * @override
   * @param {string} passphrase - The passphrase.
   * @param {Uint8Array} saltBuf - Salt bytes.
   * @param {import('../../ports/CryptoPort.js').DeriveKeyParams} params - KDF parameters.
   * @returns {Promise<Uint8Array>}
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
   * @param {Uint8Array} saltBuf - Salt bytes.
   * @param {{ iterations: number, keyLength: number }} params - PBKDF2 parameters.
   * @returns {Promise<Uint8Array>}
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
    return new Uint8Array(bits);
  }

  /**
   * Derives a key using scrypt.
   * @param {string} _passphrase - The passphrase.
   * @param {Uint8Array} _saltBuf - Salt bytes.
   * @param {{ cost: number, blockSize: number, parallelization: number, keyLength: number }} params - scrypt parameters.
   * @returns {Promise<Uint8Array>}
   */
  async #deriveScrypt(_passphrase, _saltBuf, params) {
    throw new Error(
      `scrypt KDF is unavailable in WebCryptoAdapter ` +
      `(cost=${params.cost}, blockSize=${params.blockSize}, parallelization=${params.parallelization}, keyLength=${params.keyLength})`,
    );
  }

  /**
   * Imports a raw key for use with Web Crypto AES-GCM operations.
   * @param {Uint8Array} rawKey - 32-byte raw key material.
   * @returns {Promise<CryptoKey>}
   */
  async #importKey(rawKey) {
    return globalThis.crypto.subtle.importKey(
      'raw',
      // @ts-ignore -- Uint8Array satisfies BufferSource at runtime
      /** @type {Uint8Array} */ (rawKey),
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * @override
   * @param {Uint8Array} buffer - Plaintext to encrypt.
   * @param {Uint8Array} key - 32-byte encryption key.
   * @param {Uint8Array} nonce - 12-byte nonce (IV).
   * @returns {Promise<{ buf: Uint8Array, tag: Uint8Array }>}
   */
  async encryptBufferWithNonce(buffer, key, nonce) {
    this._validateKey(key);
    if (nonce.length !== 12) {
      throw new CasError('Nonce must be 12 bytes', 'INVALID_NONCE_LENGTH', { actual: nonce.length });
    }
    const cryptoKey = await this.#importKey(key);
    const encrypted = await globalThis.crypto.subtle.encrypt(
      // @ts-ignore -- Uint8Array satisfies BufferSource at runtime
      { name: 'AES-GCM', iv: /** @type {Uint8Array} */ (nonce) },
      cryptoKey,
      buffer,
    );
    const fullBuffer = new Uint8Array(encrypted);
    const tagLength = 16;
    return {
      buf: fullBuffer.slice(0, -tagLength),
      tag: fullBuffer.slice(-tagLength),
    };
  }

  /**
   * @override
   * @param {Uint8Array} buffer - Ciphertext to decrypt.
   * @param {Uint8Array} key - 32-byte encryption key.
   * @param {Uint8Array} nonce - 12-byte nonce (IV).
   * @param {Uint8Array} tag - 16-byte GCM authentication tag.
   * @returns {Promise<Uint8Array>}
   */
  async decryptBufferWithNonceTag(buffer, key, nonce, tag) { // eslint-disable-line max-params
    this._validateKey(key);
    if (nonce.length !== 12) {
      throw new CasError('Nonce must be 12 bytes', 'INVALID_NONCE_LENGTH', { actual: nonce.length });
    }
    if (tag.length !== 16) {
      throw new CasError('Tag must be 16 bytes', 'INVALID_TAG_LENGTH', { actual: tag.length });
    }
    const cryptoKey = await this.#importKey(key);
    const combined = new Uint8Array(buffer.length + tag.length);
    combined.set(new Uint8Array(buffer));
    combined.set(new Uint8Array(tag), buffer.length);
    try {
      const decrypted = await globalThis.crypto.subtle.decrypt(
        // @ts-ignore -- Uint8Array satisfies BufferSource at runtime
        { name: 'AES-GCM', iv: /** @type {Uint8Array} */ (nonce) },
        cryptoKey,
        combined,
      );
      return new Uint8Array(decrypted);
    } catch (err) {
      throw new CasError('Decryption failed', 'INTEGRITY_ERROR', { originalError: err });
    }
  }

  /** @override */
  async hmacSha256(key, data) {
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, data);
    return new Uint8Array(signature);
  }
}
