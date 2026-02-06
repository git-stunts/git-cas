import CryptoPort from '../../ports/CryptoPort.js';
import CasError from '../../domain/errors/CasError.js';

/**
 * Web Crypto implementation of CryptoPort.
 * Works in Deno and other environments supporting standard Web Crypto.
 */
export default class WebCryptoAdapter extends CryptoPort {
  async sha256(buf) {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  randomBytes(n) {
    return globalThis.crypto.getRandomValues(new Uint8Array(n));
  }

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

  createEncryptionStream(key) {
    this.#validateKey(key);
    const nonce = this.randomBytes(12);
    const cryptoKeyPromise = this.#importKey(key);
    
    // Web Crypto doesn't have a native streaming AES-GCM API like Node
    // We have to buffer for the one-shot call because GCM tag is computed over the whole thing.
    // NOTE: This limits the "stream" to memory capacity, matching the project's 
    // current CasService.restore limitation.
    const chunks = [];

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
      this._finalTag = fullBuffer.slice(-tagLength);

      yield Buffer.from(ciphertext);
    }.bind(this);

    const finalize = () => {
      return this.#buildMeta(nonce, this._finalTag);
    };

    return { encrypt, finalize };
  }

  async #importKey(rawKey) {
    return globalThis.crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }

  #validateKey(key) {
    if (key.length !== 32) {
      throw new CasError(
        `Encryption key must be 32 bytes, got ${key.length}`,
        'INVALID_KEY_LENGTH',
        { expected: 32, actual: key.length },
      );
    }
  }

  #buildMeta(nonce, tag) {
    return {
      algorithm: 'aes-256-gcm',
      nonce: this.#toBase64(nonce),
      tag: this.#toBase64(tag),
      encrypted: true,
    };
  }

  #toBase64(buf) {
    if (globalThis.Buffer) {
      return Buffer.from(buf).toString('base64');
    }
    return globalThis.btoa(String.fromCharCode(...new Uint8Array(buf)));
  }

  #fromBase64(str) {
    if (globalThis.Buffer) {
      return Buffer.from(str, 'base64');
    }
    return Uint8Array.from(globalThis.atob(str), c => c.charCodeAt(0));
  }
}