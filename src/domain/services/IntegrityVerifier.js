import CasError from '../errors/CasError.js';
import { concatBytes } from '../bytes/ByteLayout.js';
import { buildFramedAad, buildWholeAad } from '../strategies/Aad.js';
import { SCHEME_CONVERGENT, SCHEME_FRAMED } from '../encryption/schemes.js';
import { ErrorCodes } from '../errors/index.js';

/** @typedef {import('../value-objects/Manifest.js').default} Manifest */

/**
 * Stored content integrity verification boundary.
 */
export default class IntegrityVerifier {
  #chunks;
  #crypto;
  #framed;
  #isLegacyNoAad;
  #keyResolver;
  #observability;
  #validateEncryptionMeta;

  /**
   * @param {Object} options
   * @param {import('./ChunkRepository.js').default} options.chunks
   * @param {import('../../ports/CryptoPort.js').default} options.crypto
   * @param {import('../strategies/FramedRecordCodec.js').default} options.framed
   * @param {(manifest: Manifest) => boolean} options.isLegacyNoAad
   * @param {import('./KeyResolver.js').default} options.keyResolver
   * @param {import('../../ports/ObservabilityPort.js').default} options.observability
   * @param {(manifest: Manifest) => object|undefined} options.validateEncryptionMeta
   */
  constructor({ chunks, crypto, framed, isLegacyNoAad, keyResolver, observability, validateEncryptionMeta }) {
    this.#chunks = chunks;
    this.#crypto = crypto;
    this.#framed = framed;
    this.#isLegacyNoAad = isLegacyNoAad;
    this.#keyResolver = keyResolver;
    this.#observability = observability;
    this.#validateEncryptionMeta = validateEncryptionMeta;
  }

  /**
   * @param {Manifest} manifest
   * @param {{ encryptionKey?: Uint8Array, passphrase?: string }} [options]
   * @returns {Promise<boolean>}
   */
  async verify(manifest, options = {}) {
    const encryptionMeta = this.#getVerifyEncryptionMeta(manifest);
    if (encryptionMeta === false) {
      return false;
    }
    if (encryptionMeta?.scheme === SCHEME_CONVERGENT) {
      return this.#verifyConvergentIntegrity(manifest, options);
    }
    return this.#verifyNonConvergentIntegrity(manifest, encryptionMeta, options);
  }

  #getVerifyEncryptionMeta(manifest) {
    try {
      return this.#validateEncryptionMeta(manifest);
    } catch (err) {
      if (err instanceof CasError && err.code === ErrorCodes.INTEGRITY_ERROR) {
        this.#emitIntegrityFail(manifest, err.meta);
        return false;
      }
      throw err;
    }
  }

  async #verifyNonConvergentIntegrity(manifest, encryptionMeta, options) {
    const buffers = await this.#verifyChunkDigests(manifest);
    if (buffers === false) {
      return false;
    }

    if (encryptionMeta) {
      const key = await this.#resolveVerifyKey(manifest, options);
      if (key === false) {
        return false;
      }
      const authOk = encryptionMeta.scheme === SCHEME_FRAMED
        ? await this.#verifyFramedAuth({ manifest, encryptionMeta, key, buffers })
        : await this.#verifyEncryptedAuth({ manifest, encryptionMeta, key, buffers });
      if (!authOk) {
        return false;
      }
    }

    this.#observability.metric('integrity', { action: 'pass', slug: manifest.slug });
    return true;
  }

  async #verifyConvergentIntegrity(manifest, options) {
    const key = await this.#resolveVerifyKey(manifest, options);
    if (key === false) {
      return false;
    }

    try {
      for (const chunk of manifest.chunks) {
        await this.#chunks.readAndVerifyChunk(chunk, { convergentKey: key });
      }
    } catch (err) {
      if (err instanceof CasError && err.code === ErrorCodes.INTEGRITY_ERROR) {
        this.#emitIntegrityFail(manifest, err.meta);
        return false;
      }
      throw err;
    }

    this.#observability.metric('integrity', { action: 'pass', slug: manifest.slug });
    return true;
  }

  async #verifyChunkDigests(manifest) {
    const buffers = [];
    for (const chunk of manifest.chunks) {
      const blob = await this.#chunks.readChunkBlob(chunk.blob);
      const digest = await this.#crypto.sha256(blob);
      if (digest !== chunk.digest) {
        this.#emitIntegrityFail(manifest, {
          chunkIndex: chunk.index,
          expected: chunk.digest,
          actual: digest,
        });
        return false;
      }
      buffers.push(blob);
    }
    return buffers;
  }

  async #resolveVerifyKey(manifest, options) {
    try {
      return await this.#keyResolver.resolveForDecryption(
        manifest,
        options.encryptionKey,
        options.passphrase,
      );
    } catch (err) {
      if (err instanceof CasError && [ErrorCodes.MISSING_KEY, ErrorCodes.NO_MATCHING_RECIPIENT, ErrorCodes.DEK_UNWRAP_FAILED].includes(err.code)) {
        this.#emitIntegrityFail(manifest, { reason: 'auth', code: err.code });
        return false;
      }
      throw err;
    }
  }

  async #verifyEncryptedAuth({ manifest, encryptionMeta, key, buffers }) {
    try {
      const aad = this.#isLegacyNoAad(manifest) ? undefined : buildWholeAad(manifest.slug);
      await this.#crypto.decryptBuffer(concatBytes(buffers), key, encryptionMeta, aad);
      return true;
    } catch (err) {
      if (err instanceof CasError && err.code === ErrorCodes.INTEGRITY_ERROR) {
        this.#emitIntegrityFail(manifest, { reason: 'auth', code: err.code });
        return false;
      }
      throw err;
    }
  }

  async #verifyFramedAuth({ manifest, encryptionMeta, key, buffers }) {
    try {
      const source = (async function* framedSource() {
        for (const buffer of buffers) {
          yield buffer;
        }
      })();

      const legacyNoAad = this.#isLegacyNoAad(manifest);
      let frameIndex = 0;
      for await (const record of this.#framed.parse(source, encryptionMeta.frameBytes)) {
        const aad = legacyNoAad ? undefined : buildFramedAad(manifest.slug, frameIndex);
        await this.#framed.decryptRecord({ record, key, aad });
        frameIndex++;
      }

      return true;
    } catch (err) {
      if (err instanceof CasError && err.code === ErrorCodes.INTEGRITY_ERROR) {
        this.#emitIntegrityFail(manifest, {
          reason: err.meta?.reason === 'framed-record-parse' ? 'framing' : 'auth',
          code: err.code,
          ...err.meta,
        });
        return false;
      }
      throw err;
    }
  }

  #emitIntegrityFail(manifest, extra = {}) {
    this.#observability.metric('integrity', {
      action: 'fail',
      slug: manifest.slug,
      ...extra,
    });
  }
}
