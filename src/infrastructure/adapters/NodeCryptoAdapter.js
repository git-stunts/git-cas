import { createHash, createCipheriv, createDecipheriv, randomBytes, pbkdf2, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import CryptoPort from '../../ports/CryptoPort.js';

/**
 * Node.js implementation of CryptoPort using node:crypto.
 */
export default class NodeCryptoAdapter extends CryptoPort {
  /**
   * @override
   * @param {Buffer|Uint8Array} buf - Data to hash.
   * @returns {Promise<string>} 64-char hex digest.
   */
  async sha256(buf) {
    return createHash('sha256').update(buf).digest('hex');
  }

  /**
   * @override
   * @param {number} n - Number of random bytes.
   * @returns {Buffer}
   */
  randomBytes(n) {
    return randomBytes(n);
  }

  /**
   * @override
   * @param {Buffer|Uint8Array} buffer - Plaintext to encrypt.
   * @param {Buffer|Uint8Array} key - 32-byte encryption key.
   * @returns {{ buf: Buffer, meta: import('../../ports/CryptoPort.js').EncryptionMeta }}
   */
  encryptBuffer(buffer, key) {
    this._validateKey(key);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const enc = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      buf: enc,
      meta: this._buildMeta(nonce.toString('base64'), tag.toString('base64')),
    };
  }

  /**
   * @override
   * @param {Buffer|Uint8Array} buffer - Ciphertext to decrypt.
   * @param {Buffer|Uint8Array} key - 32-byte encryption key.
   * @param {import('../../ports/CryptoPort.js').EncryptionMeta} meta - Encryption metadata.
   * @returns {Buffer}
   */
  decryptBuffer(buffer, key, meta) {
    const nonce = Buffer.from(meta.nonce, 'base64');
    const tag = Buffer.from(meta.tag, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buffer), decipher.final()]);
  }

  /**
   * @override
   * @param {Buffer|Uint8Array} key - 32-byte encryption key.
   * @returns {{ encrypt: (source: AsyncIterable<Buffer>) => AsyncIterable<Buffer>, finalize: () => import('../../ports/CryptoPort.js').EncryptionMeta }}
   */
  createEncryptionStream(key) {
    this._validateKey(key);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);

    /** @param {AsyncIterable<Buffer>} source */
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
      return this._buildMeta(nonce.toString('base64'), tag.toString('base64'));
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
      return await promisify(pbkdf2)(passphrase, saltBuf, iterations, keyLength, 'sha512');
    }
    // @ts-ignore -- promisify(scrypt) accepts options as 4th arg at runtime
    return await promisify(scrypt)(passphrase, saltBuf, keyLength, {
      N: cost,
      r: blockSize,
      p: parallelization,
    });
  }
}
