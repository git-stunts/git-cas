import { CryptoHasher } from 'bun';
import CryptoPort from '../../ports/CryptoPort.js';
import CasError from '../../domain/errors/CasError.js';
// We still use node:crypto for AES-GCM because Bun's native implementation 
// is heavily optimized for these specific Node APIs.
import { createCipheriv, createDecipheriv } from 'node:crypto';

/**
 * Bun-native implementation of CryptoPort.
 * Uses Bun.CryptoHasher for fast SHA-256 and globalThis.crypto for random bytes.
 */
export default class BunCryptoAdapter extends CryptoPort {
  sha256(buf) {
    return new CryptoHasher('sha256').update(buf).digest('hex');
  }

  randomBytes(n) {
    return crypto.getRandomValues(new Uint8Array(n));
  }

  encryptBuffer(buffer, key) {
    this.#validateKey(key);
    const nonce = this.randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const enc = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      buf: enc,
      meta: this.#buildMeta(nonce, tag),
    };
  }

  decryptBuffer(buffer, key, meta) {
    const nonce = Buffer.from(meta.nonce, 'base64');
    const tag = Buffer.from(meta.tag, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buffer), decipher.final()]);
  }

  createEncryptionStream(key) {
    this.#validateKey(key);
    const nonce = this.randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);

    const encrypt = async function* (source) {
      for await (const chunk of source) {
        const encrypted = cipher.update(chunk);
        if (encrypted.length > 0) {
          yield encrypted;
        }
      }
      const final = cipher.final();
      if (final.length > 0) {
        yield final;
      }
    };

    const finalize = () => {
      const tag = cipher.getAuthTag();
      return this.#buildMeta(nonce, tag);
    };

    return { encrypt, finalize };
  }

  #validateKey(key) {
    if (!Buffer.isBuffer(key) && !(key instanceof Uint8Array)) {
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

  #buildMeta(nonce, tag) {
    return {
      algorithm: 'aes-256-gcm',
      nonce: Buffer.from(nonce).toString('base64'),
      tag: tag.toString('base64'),
      encrypted: true,
    };
  }
}