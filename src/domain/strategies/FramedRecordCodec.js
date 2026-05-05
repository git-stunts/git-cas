import CasError from '../errors/CasError.js';
import { concatBytes, normalizeByteChunk, readUint32BE, writeUint32BE } from '../bytes/ByteLayout.js';
import { decodeBase64, encodeBase64 } from '../encoding/base64.js';
import { buildFramedAad } from './Aad.js';

const FRAMED_LENGTH_BYTES = 4;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const FRAMED_RECORD_HEADER_BYTES = FRAMED_LENGTH_BYTES + GCM_NONCE_BYTES + GCM_TAG_BYTES;

/**
 * Owns framed encryption record byte layout and parsing.
 */
export default class FramedRecordCodec {
  #crypto;
  #observability;

  /**
   * @param {Object} options
   * @param {import('../../ports/CryptoPort.js').default} options.crypto
   * @param {import('../../ports/ObservabilityPort.js').default} options.observability
   */
  constructor({ crypto, observability }) {
    this.#crypto = crypto;
    this.#observability = observability;
  }

  /**
   * @param {AsyncIterable<Uint8Array>} source
   * @param {Uint8Array} key
   * @param {{ frameBytes: number, slug: string }} options
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *encryptFrames(source, key, { frameBytes, slug }) {
    let pending = new Uint8Array(0);
    let sawPlaintext = false;
    let frameIndex = 0;

    for await (const chunk of source) {
      const buf = normalizeByteChunk(chunk);
      if (buf.length === 0) {
        continue;
      }

      sawPlaintext = true;
      pending = pending.length === 0 ? buf : concatBytes([pending, buf]);

      while (pending.length >= frameBytes) {
        const frame = pending.subarray(0, frameBytes);
        pending = pending.subarray(frameBytes);
        yield await this.serialize(frame, key, buildFramedAad(slug, frameIndex));
        frameIndex++;
      }
    }

    if (pending.length > 0) {
      yield await this.serialize(pending, key, buildFramedAad(slug, frameIndex));
      return;
    }

    if (!sawPlaintext) {
      yield await this.serialize(new Uint8Array(0), key, buildFramedAad(slug, frameIndex));
    }
  }

  /**
   * @param {Uint8Array} frame
   * @param {Uint8Array} key
   * @param {Uint8Array} [aad]
   * @returns {Promise<Uint8Array>}
   */
  async serialize(frame, key, aad) {
    const { buf, meta } = await this.#crypto.encryptBuffer(frame, key, aad);
    const nonce = decodeBase64(meta.nonce);
    const tag = decodeBase64(meta.tag);
    const header = new Uint8Array(FRAMED_RECORD_HEADER_BYTES);
    writeUint32BE(header, 0, buf.length);
    header.set(nonce, FRAMED_LENGTH_BYTES);
    header.set(tag, FRAMED_LENGTH_BYTES + GCM_NONCE_BYTES);
    return concatBytes([header, buf]);
  }

  /**
   * @param {AsyncIterable<Uint8Array>} source
   * @param {number} frameBytes
   * @returns {AsyncIterable<{ ciphertext: Uint8Array, meta: { encrypted: true, algorithm: 'aes-256-gcm', nonce: string, tag: string } }>}
   */
  async *parse(source, frameBytes) {
    let pending = new Uint8Array(0);

    for await (const chunk of source) {
      const buf = normalizeByteChunk(chunk);
      pending = pending.length === 0 ? buf : concatBytes([pending, buf]);

      while (pending.length >= FRAMED_RECORD_HEADER_BYTES) {
        const consumed = this.consume(pending, frameBytes);
        if (!consumed) {
          break;
        }
        pending = consumed.remaining;
        yield consumed.record;
      }
    }

    if (pending.length > 0) {
      throw new CasError(
        'Framed ciphertext is truncated or malformed',
        'INTEGRITY_ERROR',
        { reason: 'framed-record-parse', remainingBytes: pending.length },
      );
    }
  }

  /**
   * @param {Uint8Array} pending
   * @param {number} frameBytes
   * @returns {null|{ remaining: Uint8Array, record: { ciphertext: Uint8Array, meta: { encrypted: true, algorithm: 'aes-256-gcm', nonce: string, tag: string } } }}
   */
  consume(pending, frameBytes) {
    const ciphertextLength = readUint32BE(pending, 0);
    if (ciphertextLength > frameBytes) {
      throw new CasError(
        `Framed ciphertext length ${ciphertextLength} exceeds frameBytes ${frameBytes}`,
        'INTEGRITY_ERROR',
        { reason: 'framed-record-parse', ciphertextLength, frameBytes },
      );
    }

    const recordLength = FRAMED_RECORD_HEADER_BYTES + ciphertextLength;
    if (pending.length < recordLength) {
      return null;
    }

    return {
      remaining: pending.subarray(recordLength),
      record: {
        ciphertext: pending.subarray(FRAMED_RECORD_HEADER_BYTES, recordLength),
        meta: this.buildMeta(pending),
      },
    };
  }

  /**
   * @param {Uint8Array} pending
   * @returns {{ encrypted: true, algorithm: 'aes-256-gcm', nonce: string, tag: string }}
   */
  buildMeta(pending) {
    return {
      encrypted: true,
      algorithm: 'aes-256-gcm',
      nonce: encodeBase64(pending.subarray(FRAMED_LENGTH_BYTES, FRAMED_LENGTH_BYTES + GCM_NONCE_BYTES)),
      tag: encodeBase64(pending.subarray(FRAMED_LENGTH_BYTES + GCM_NONCE_BYTES, FRAMED_RECORD_HEADER_BYTES)),
    };
  }

  /**
   * @param {{ record: { ciphertext: Uint8Array, meta: object }, key: Uint8Array, aad?: Uint8Array }} options
   * @returns {Promise<Uint8Array>}
   */
  async decryptRecord({ record, key, aad }) {
    try {
      return await this.#crypto.decryptBuffer(record.ciphertext, key, record.meta, aad);
    } catch (err) {
      if (err instanceof CasError) {
        throw err;
      }
      throw new CasError('Decryption failed: Integrity check error', 'INTEGRITY_ERROR', { originalError: err });
    }
  }

  /**
   * @param {Object} options
   * @param {import('../value-objects/Manifest.js').default} options.manifest
   * @param {AsyncIterable<Uint8Array>} options.source
   * @param {Uint8Array} options.key
   * @param {{ frameBytes: number }} options.encryptionMeta
   * @param {boolean} options.legacyNoAad
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *decryptSource({ manifest, source, key, encryptionMeta, legacyNoAad }) {
    let frameIndex = 0;
    for await (const record of this.parse(source, encryptionMeta.frameBytes)) {
      let plaintext;
      try {
        const aad = legacyNoAad ? undefined : buildFramedAad(manifest.slug, frameIndex);
        plaintext = await this.decryptRecord({ record, key, aad });
      } catch (err) {
        if (err instanceof CasError && err.code === 'INTEGRITY_ERROR') {
          this.#observability.metric('error', { action: 'decryption_failed', slug: manifest.slug });
        }
        throw err;
      }

      frameIndex++;
      if (plaintext.length > 0) {
        yield plaintext;
      }
    }
  }
}
