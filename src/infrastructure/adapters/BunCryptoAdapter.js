// @ts-ignore -- 'bun' module only available in Bun runtime
import { CryptoHasher } from 'bun';
import CryptoPort from '../../ports/CryptoPort.js';
import CasError from '../../domain/errors/CasError.js';
import scryptMaxmem from '../../domain/helpers/scryptMaxmem.js';
// We still use node:crypto for AES-GCM because Bun's native implementation
// is heavily optimized for these specific Node APIs.
import { createCipheriv, createDecipheriv, pbkdf2, scrypt } from 'node:crypto';
import { promisify } from 'node:util';

function wrapDecryptError(err) {
  if (err instanceof CasError) {
    throw err;
  }
  throw new CasError('Decryption failed: Integrity check error', 'INTEGRITY_ERROR', {
    originalError: err,
  });
}

/**
 * Bun-native {@link CryptoPort} implementation.
 *
 * Uses `Bun.CryptoHasher` for fast SHA-256 hashing, `globalThis.crypto`
 * for random bytes, and Node's `createCipheriv`/`createDecipheriv` for
 * AES-256-GCM (Bun's Node compat layer is heavily optimized for these APIs).
 */
export default class BunCryptoAdapter extends CryptoPort {
  /**
   * @override
   * @param {Buffer|Uint8Array} buf - Data to hash.
   * @returns {Promise<string>} 64-char hex digest.
   */
  async sha256(buf) {
    return new CryptoHasher('sha256').update(buf).digest('hex');
  }

  /**
   * @override
   * @param {number} n - Number of random bytes.
   * @returns {Buffer}
   */
  randomBytes(n) {
    const uint8 = globalThis.crypto.getRandomValues(new Uint8Array(n));
    return Buffer.from(uint8.buffer, uint8.byteOffset, uint8.byteLength);
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
   * @returns {Promise<Buffer>}
   */
  async decryptBuffer(buffer, key, meta) {
    this._validateKey(key);
    const nonce = Buffer.from(meta.nonce, 'base64');
    const tag = Buffer.from(meta.tag, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, nonce, {
      authTagLength: tag.length,
    });
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
    const nonce = this.randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    let streamFinalized = false;

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
      streamFinalized = true;
    };

    const finalize = () => {
      if (!streamFinalized) {
        throw new CasError(
          'Cannot finalize before the encrypt stream is fully consumed',
          'STREAM_NOT_CONSUMED',
        );
      }
      const tag = cipher.getAuthTag();
      return this._buildMeta(nonce.toString('base64'), tag.toString('base64'));
    };

    return { encrypt, finalize };
  }

  /**
   * @override
   * @param {Buffer|Uint8Array} key - 32-byte encryption key.
   * @param {import('../../ports/CryptoPort.js').EncryptionMeta} meta - Encryption metadata.
   * @returns {{ decrypt: (source: AsyncIterable<Buffer>) => AsyncIterable<Buffer> }}
   */
  createDecryptionStream(key, meta) {
    this._validateKey(key);
    const nonce = Buffer.from(meta.nonce, 'base64');
    const tag = Buffer.from(meta.tag, 'base64');

    return {
      decrypt: async function* (source) {
        try {
          const decipher = createDecipheriv('aes-256-gcm', key, nonce, {
            authTagLength: tag.length,
          });
          decipher.setAuthTag(tag);

          for await (const chunk of source) {
            const decrypted = decipher.update(chunk);
            if (decrypted.length > 0) {
              yield decrypted;
            }
          }

          const final = decipher.final();
          if (final.length > 0) {
            yield final;
          }
        } catch (err) {
          wrapDecryptError(err);
        }
      },
    };
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
      return promisify(pbkdf2)(passphrase, saltBuf, iterations, keyLength, 'sha512');
    }
    // @ts-ignore -- promisify(scrypt) accepts options as 4th arg at runtime
    return promisify(scrypt)(passphrase, saltBuf, keyLength, {
      N: cost,
      r: blockSize,
      p: parallelization,
      maxmem: scryptMaxmem({ cost, blockSize, parallelization, keyLength }),
    });
  }
}
