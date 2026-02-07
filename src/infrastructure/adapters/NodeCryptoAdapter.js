import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import CryptoPort from '../../ports/CryptoPort.js';
import CasError from '../../domain/errors/CasError.js';

/**
 * Node.js implementation of CryptoPort using node:crypto.
 */
export default class NodeCryptoAdapter extends CryptoPort {
  /** @override */
  sha256(buf) {
    return createHash('sha256').update(buf).digest('hex');
  }

  /** @override */
  randomBytes(n) {
    return randomBytes(n);
  }

  /** @override */
  encryptBuffer(buffer, key) {
    this.#validateKey(key);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const enc = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      buf: enc,
      meta: this.#buildMeta(nonce, tag),
    };
  }

  /** @override */
  decryptBuffer(buffer, key, meta) {
    const nonce = Buffer.from(meta.nonce, 'base64');
    const tag = Buffer.from(meta.tag, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buffer), decipher.final()]);
  }

  /** @override */
  createEncryptionStream(key) {
    this.#validateKey(key);
    const nonce = randomBytes(12);
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

  /**
   * Validates that a key is a 32-byte Buffer.
   * @param {Buffer} key
   * @throws {CasError} INVALID_KEY_TYPE | INVALID_KEY_LENGTH
   */
  #validateKey(key) {
    if (!Buffer.isBuffer(key)) {
      throw new CasError(
        'Encryption key must be a Buffer',
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
   * @param {Buffer} nonce - 12-byte AES-GCM nonce.
   * @param {Buffer} tag - 16-byte GCM authentication tag.
   * @returns {{ algorithm: string, nonce: string, tag: string, encrypted: boolean }}
   */
  #buildMeta(nonce, tag) {
    return {
      algorithm: 'aes-256-gcm',
      nonce: nonce.toString('base64'),
      tag: tag.toString('base64'),
      encrypted: true,
    };
  }
}
