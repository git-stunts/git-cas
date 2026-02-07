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
  /** @override */
  async sha256(buf) {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /** @override */
  randomBytes(n) {
    const uint8 = globalThis.crypto.getRandomValues(new Uint8Array(n));
    if (globalThis.Buffer) {
      return Buffer.from(uint8.buffer, uint8.byteOffset, uint8.byteLength);
    }
    return uint8;
  }

  /** @override */
  async encryptBuffer(buffer, key) {
    this.#validateKey(key);
    const nonce = this.randomBytes(12);
    const cryptoKey = await this.#importKey(key);
    
    // AES-GCM in Web Crypto includes the tag at the end of the ciphertext
    const encrypted = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      cryptoKey,
      buffer
    );

    const fullBuffer = new Uint8Array(encrypted);
    const tagLength = 16;
    const ciphertext = fullBuffer.slice(0, -tagLength);
    const tag = fullBuffer.slice(-tagLength);

    return {
      buf: Buffer.from(ciphertext),
      meta: this.#buildMeta(nonce, tag),
    };
  }

  /** @override */
  async decryptBuffer(buffer, key, meta) {
    const nonce = this.#fromBase64(meta.nonce);
    const tag = this.#fromBase64(meta.tag);
    const cryptoKey = await this.#importKey(key);

    // Reconstruct Web Crypto format (ciphertext + tag)
    const combined = new Uint8Array(buffer.length + tag.length);
    combined.set(new Uint8Array(buffer));
    combined.set(tag, buffer.length);

    try {
      const decrypted = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce },
        cryptoKey,
        combined
      );
      return Buffer.from(decrypted);
    } catch (err) {
      throw new CasError('Decryption failed', 'INTEGRITY_ERROR', { originalError: err });
    }
  }

  /** @override */
  createEncryptionStream(key) {
    this.#validateKey(key);
    const nonce = this.randomBytes(12);
    const cryptoKeyPromise = this.#importKey(key);
    
    // Web Crypto doesn't have a native streaming AES-GCM API like Node
    // We have to buffer for the one-shot call because GCM tag is computed over the whole thing.
    // NOTE: This limits the "stream" to memory capacity, matching the project's 
    // current CasService.restore limitation.
    const chunks = [];
    let finalTag = null;

    const encrypt = async function* (source) {
      for await (const chunk of source) {
        chunks.push(chunk);
        // We can't yield partial encrypted chunks for GCM in Web Crypto 
        // without complex chunk-chaining which would break compatibility 
        // with the Node adapter's single-stream GCM.
      }
      
      const buffer = Buffer.concat(chunks);
      const cryptoKey = await cryptoKeyPromise;
      const encrypted = await globalThis.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce },
        cryptoKey,
        buffer
      );

      const fullBuffer = new Uint8Array(encrypted);
      const tagLength = 16;
      const ciphertext = fullBuffer.slice(0, -tagLength);
      finalTag = fullBuffer.slice(-tagLength);

      yield Buffer.from(ciphertext);
    };

    const finalize = () => {
      return this.#buildMeta(nonce, finalTag);
    };

    return { encrypt, finalize };
  }

  /** @override */
  async deriveKey({
    passphrase,
    salt,
    algorithm = 'pbkdf2',
    iterations = 100_000,
    cost = 16384,
    blockSize = 8,
    parallelization = 1,
    keyLength = 32,
  }) {
    const saltBuf = salt || this.randomBytes(32);
    const params = { algorithm, salt: this.#toBase64(saltBuf), keyLength };

    const opts = { passphrase, saltBuf, iterations, cost, blockSize, parallelization, keyLength, params };
    let key;
    if (algorithm === 'pbkdf2') {
      key = await this.#derivePbkdf2(opts);
    } else if (algorithm === 'scrypt') {
      key = await this.#deriveScrypt(opts);
    } else {
      throw new Error(`Unsupported KDF algorithm: ${algorithm}`);
    }

    return { key: Buffer.from(key), salt: Buffer.from(saltBuf), params };
  }

  async #derivePbkdf2({ passphrase, saltBuf, iterations, keyLength, params }) {
    const enc = new globalThis.TextEncoder();
    const baseKey = await globalThis.crypto.subtle.importKey(
      'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits'],
    );
    const bits = await globalThis.crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBuf, iterations, hash: 'SHA-512' },
      baseKey, keyLength * 8,
    );
    params.iterations = iterations;
    return Buffer.from(bits);
  }

  async #deriveScrypt({ passphrase, saltBuf, cost, blockSize, parallelization, keyLength, params }) {
    let scryptCb;
    let promisifyFn;
    try {
      ({ scrypt: scryptCb } = await import('node:crypto'));
      ({ promisify: promisifyFn } = await import('node:util'));
    } catch {
      throw new Error('scrypt KDF requires a Node.js-compatible runtime (node:crypto unavailable)');
    }
    const key = await promisifyFn(scryptCb)(passphrase, saltBuf, keyLength, {
      N: cost, r: blockSize, p: parallelization,
    });
    params.cost = cost;
    params.blockSize = blockSize;
    params.parallelization = parallelization;
    return key;
  }

  /**
   * Imports a raw key for use with Web Crypto AES-GCM operations.
   * @param {Buffer|Uint8Array} rawKey - 32-byte raw key material.
   * @returns {Promise<CryptoKey>}
   */
  async #importKey(rawKey) {
    return globalThis.crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Validates that a key is a 32-byte Buffer or Uint8Array.
   * @param {Buffer|Uint8Array} key
   * @throws {CasError} INVALID_KEY_TYPE | INVALID_KEY_LENGTH
   */
  #validateKey(key) {
    if (!globalThis.Buffer?.isBuffer(key) && !(key instanceof Uint8Array)) {
      throw new CasError(
        'Encryption key must be a Buffer or Uint8Array',
        'INVALID_KEY_TYPE',
      );
    }
    if (key.length !== 32) {
      throw new CasError(
        `Encryption key must be 32 bytes, got ${key.length}`,
        'INVALID_KEY_LENGTH',
        { expected: 32, actual: key.length },
      );
    }
  }

  /**
   * Builds the encryption metadata object.
   * @param {Uint8Array} nonce - 12-byte AES-GCM nonce.
   * @param {Uint8Array} tag - 16-byte GCM authentication tag.
   * @returns {{ algorithm: string, nonce: string, tag: string, encrypted: boolean }}
   */
  #buildMeta(nonce, tag) {
    return {
      algorithm: 'aes-256-gcm',
      nonce: this.#toBase64(nonce),
      tag: this.#toBase64(tag),
      encrypted: true,
    };
  }

  /**
   * Encodes binary data to base64, using Buffer when available.
   * @param {Uint8Array} buf
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
   * @param {string} str
   * @returns {Buffer|Uint8Array}
   */
  #fromBase64(str) {
    if (globalThis.Buffer) {
      return Buffer.from(str, 'base64');
    }
    return Uint8Array.from(globalThis.atob(str), c => c.charCodeAt(0));
  }
}