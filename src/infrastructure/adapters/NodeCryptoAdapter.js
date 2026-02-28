import { createHash, createCipheriv, createDecipheriv, randomBytes, pbkdf2, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import CryptoPort from '../../ports/CryptoPort.js';

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
    this._validateKey(key);
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
      return this._buildMeta(nonce.toString('base64'), tag.toString('base64'));
    };

    return { encrypt, finalize };
  }

  /** @override – delegate to base class which accepts both Buffer and Uint8Array */

  /** @override */
  async _doDeriveKey(passphrase, saltBuf, { algorithm, iterations, cost, blockSize, parallelization, keyLength }) {
    if (algorithm === 'pbkdf2') {
      return promisify(pbkdf2)(passphrase, saltBuf, iterations, keyLength, 'sha512');
    }
    return promisify(scrypt)(passphrase, saltBuf, keyLength, {
      N: cost,
      r: blockSize,
      p: parallelization,
    });
  }
}
