/* @ts-self-types="./CasService.d.ts" */
/**
 * @fileoverview Domain service for Content Addressable Storage operations.
 * @module
 */
import Manifest from '../value-objects/Manifest.js';
import { ChunkSchema } from '../schemas/ManifestSchema.js';
import CasError from '../errors/CasError.js';
import Semaphore from './Semaphore.js';
import KeyResolver from './KeyResolver.js';
import ConvergentEncryption from './ConvergentEncryption.js';
import diffManifests from './ManifestDiff.js';
import prefetchChunks from './PrefetchWindow.js';
import GitPersistencePort from '../../ports/GitPersistencePort.js';
import {
  concatBytes,
  normalizeByteChunk,
  readUint32BE,
  writeUint32BE,
} from '../bytes/ByteLayout.js';
import { decodeBase64, encodeBase64 } from '../encoding/base64.js';
import { utf8Encode } from '../encoding/utf8.js';
import {
  SCHEME_WHOLE, SCHEME_FRAMED, SCHEME_CONVERGENT,
  assertCurrentScheme,
  mapToCurrentScheme, isLegacyNoAad,
} from '../encryption/schemes.js';

/**
 * Tracks the original legacy scheme for manifests read in legacy mode.
 * Used to determine AAD policy: v1 schemes had no AAD, v2 schemes did.
 * @type {WeakMap<import('../value-objects/Manifest.js').default, string>}
 */
const originalSchemeMap = new WeakMap();

/**
 * Builds AAD for whole encryption: UTF-8 bytes of the slug.
 * @param {string} slug
 * @returns {Uint8Array}
 */
function buildWholeAad(slug) {
  return utf8Encode(slug);
}

/**
 * Builds AAD for framed encryption: UTF-8 slug + NUL + 4-byte BE frame index.
 * @param {string} slug
 * @param {number} frameIndex
 * @returns {Uint8Array}
 */
function buildFramedAad(slug, frameIndex) {
  const slugBytes = utf8Encode(slug);
  const bytes = new Uint8Array(slugBytes.length + 5);
  bytes.set(slugBytes, 0);
  bytes[slugBytes.length] = 0;
  writeUint32BE(bytes, slugBytes.length + 1, frameIndex);
  return bytes;
}

/**
 * Strips `manifestHash` and `undefined` values, then returns codec-encoded bytes.
 * @param {Object} data - Manifest data object.
 * @param {{ encode: Function }} codec - Codec instance.
 * @returns {Uint8Array} Encoded bytes (without manifestHash).
 */
function encodeForHash(data, codec) {
  const copy = { ...data };
  delete copy.manifestHash;
  // Remove undefined values to match codec round-trip
  for (const key of Object.keys(copy)) {
    if (copy[key] === undefined) { delete copy[key]; }
  }
  return normalizeCodecBytes(codec.encode(copy));
}

/**
 * @param {unknown} value
 * @returns {Uint8Array}
 */
function normalizeCodecBytes(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (typeof value === 'string') {
    return utf8Encode(value);
  }
  throw new TypeError('Codec output must be Uint8Array');
}

const DEFAULT_FRAMED_FRAME_BYTES = 64 * 1024;
const MAX_FRAMED_FRAME_BYTES = 64 * 1024 * 1024;
const FRAMED_LENGTH_BYTES = 4;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const FRAMED_RECORD_HEADER_BYTES = FRAMED_LENGTH_BYTES + GCM_NONCE_BYTES + GCM_TAG_BYTES;

/**
 * Domain service for Content Addressable Storage operations.
 *
 * Provides chunking, encryption, and integrity verification for storing
 * arbitrary data in Git's object database.
 */
export default class CasService {
  /** @type {KeyResolver} */
  #keyResolver;
  #convergent;
  /** @type {boolean} */
  #legacyMode;

  /**
   * @param {Object} options
   * @param {import('../../ports/GitPersistencePort.js').default} options.persistence
   * @param {import('../../ports/CodecPort.js').default} options.codec
   * @param {import('../../ports/CryptoPort.js').default} options.crypto
   * @param {import('../../ports/ObservabilityPort.js').default} options.observability
   * @param {number} [options.chunkSize=262144] - 256 KiB
   * @param {number} [options.merkleThreshold=1000] - Chunk count threshold for Merkle manifests.
   * @param {number} [options.concurrency=1] - Maximum parallel chunk I/O operations.
   * @param {import('../../ports/ChunkingPort.js').default} options.chunker - Chunking strategy.
   * @param {number} [options.maxRestoreBufferSize=536870912] - Max bytes for buffered restore (default 512 MiB).
   * @param {import('../../ports/CompressionPort.js').default} options.compressionAdapter - Compression adapter.
   * @param {string} [options.formatVersion] - Semver version stamped into new manifests.
   * @param {boolean} [options.legacyMode=false] - When true, allows reading manifests with legacy encryption schemes (v1/v2) without throwing.
   */
  constructor({ persistence, codec, crypto, observability, chunkSize = 256 * 1024, merkleThreshold = 1000, concurrency = 1, chunker, maxRestoreBufferSize = 512 * 1024 * 1024, compressionAdapter, formatVersion, legacyMode = false }) {
    CasService._validateObservability(observability);
    CasService.#validateConstructorArgs({ chunkSize, merkleThreshold, concurrency, maxRestoreBufferSize });
    this.persistence = persistence;
    this.codec = codec;
    this.crypto = crypto;
    this.observability = observability;
    this.chunkSize = chunkSize;
    if (chunkSize > 10 * 1024 * 1024) {
      observability.log('warn', `Chunk size ${chunkSize} exceeds 10 MiB — consider a smaller value`, { chunkSize });
    }
    if (!chunker) {
      throw new Error('chunker is required — inject a ChunkingPort instance');
    }
    if (!compressionAdapter) {
      throw new Error('compressionAdapter is required — inject a CompressionPort instance');
    }
    /** @type {import('../../ports/ChunkingPort.js').default} */
    this.chunker = chunker;
    /** @type {import('../../ports/CompressionPort.js').default} */
    this.compressionAdapter = compressionAdapter;
    /** @type {string|undefined} */
    this.formatVersion = formatVersion;
    this.merkleThreshold = merkleThreshold;
    this.concurrency = concurrency;
    this.maxRestoreBufferSize = maxRestoreBufferSize;
    this.#keyResolver = new KeyResolver(crypto);
    this.#convergent = new ConvergentEncryption(crypto);
    this.#legacyMode = legacyMode;
  }

  /**
   * Validates constructor numeric arguments.
   * @private
   */
  static #assertIntRange({ value, min, max, label }) {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${label} must be an integer in [${min}, ${max}]`);
    }
  }

  static #validateConstructorArgs({ chunkSize, merkleThreshold, concurrency, maxRestoreBufferSize }) {
    CasService.#assertIntRange({ value: chunkSize, min: 1024, max: 100 * 1024 * 1024, label: 'chunkSize' });
    CasService.#assertIntRange({ value: merkleThreshold, min: 1, max: Number.MAX_SAFE_INTEGER, label: 'merkleThreshold' });
    CasService.#assertIntRange({ value: concurrency, min: 1, max: 64, label: 'concurrency' });
    CasService.#assertIntRange({ value: maxRestoreBufferSize, min: 1024, max: Number.MAX_SAFE_INTEGER, label: 'maxRestoreBufferSize' });
  }

  /**
   * Validates that observability implements ObservabilityPort.
   * @private
   * @param {*} observability
   */
  static _validateObservability(observability) {
    if (
      !observability ||
      typeof observability.metric !== 'function' ||
      typeof observability.log !== 'function' ||
      typeof observability.span !== 'function'
    ) {
      throw new Error('observability must implement ObservabilityPort');
    }
  }

  /**
   * Generates a SHA-256 hex digest for a buffer.
   * @private
   * @param {Uint8Array} buf - Data to hash.
   * @returns {Promise<string>} 64-character hex digest.
   */
  async _sha256(buf) {
    return await this.crypto.sha256(buf);
  }

  /**
   * Stores a single buffer chunk in Git, returning its metadata.
   *
   * When `convergentKey` is provided, the chunk is encrypted per-chunk
   * using deterministic key/nonce derived from its content hash, enabling
   * deduplication of identical plaintext across encrypted stores.
   *
   * @private
   * @param {Uint8Array} buf - The chunk data to store.
   * @param {number} index - Chunk index.
   * @param {Uint8Array} [convergentKey] - Convergent encryption master key.
   * @returns {Promise<{ index: number, size: number, digest: string, blob: string }>}
   */
  async _storeChunk(buf, index, convergentKey) {
    const digest = await this._sha256(buf);
    const blobData = convergentKey
      ? await this.#convergent.encryptChunk(buf, convergentKey, digest)
      : buf;
    const blob = await this.persistence.writeBlob(blobData);
    this.observability.metric('chunk', { action: 'stored', index, size: buf.length, digest, blob });
    return { index, size: buf.length, digest, blob };
  }

  /**
   * Reads an async iterable source, splits it into chunks via the configured
   * chunker, and stores each chunk in Git.
   * @private
   * @param {AsyncIterable<Uint8Array>} source - The data source to chunk.
   * @param {Object} manifestData - Mutable manifest accumulator.
   * @param {{ convergentKey?: Uint8Array }} [options] - Optional encryption options.
   * @throws {CasError} STREAM_ERROR if the source stream fails.
   */
  async _chunkAndStore(source, manifestData, { convergentKey } = {}) {
    const sem = new Semaphore(this.concurrency);
    const iterator = this.chunker.chunk(source)[Symbol.asyncIterator]();
    const results = [];
    const inFlight = new Set();
    const orphanedBlobs = [];
    const state = { nextIndex: 0, writeError: null, failedIndex: null };

    while (true) {
      // Acquire capacity before pulling the next chunk so slow writes apply
      // backpressure all the way to the upstream source iterator.
      await sem.acquire();

      if (state.writeError) {
        sem.release();
        await this._closeAsyncIterator(iterator);
        break;
      }

      const step = await this._readNextStoreChunk({
        iterator, sem, inFlight, orphanedBlobs, nextIndex: state.nextIndex,
      });

      if (step.done) {
        sem.release();
        break;
      }

      this._launchChunkWrite({
        buf: step.value, idx: state.nextIndex++, sem, results, orphanedBlobs, inFlight, state, convergentKey,
      });
    }

    await this._awaitChunkWrites({ inFlight, state, orphanedBlobs });
    this._appendChunkEntries(manifestData, results);
  }

  /**
   * Starts one bounded chunk write and tracks its lifecycle.
   * @private
   */
  _launchChunkWrite({ buf, idx, sem, results, orphanedBlobs, inFlight, state, convergentKey }) {
    const task = (async () => {
      try {
        const entry = await this._storeChunk(buf, idx, convergentKey);
        results[idx] = entry;
        orphanedBlobs.push(entry.blob);
      } finally {
        sem.release();
      }
    })().catch((err) => {
      state.writeError ??= err;
      state.failedIndex ??= idx;
      throw err;
    });

    inFlight.add(task);
    task.then(
      () => inFlight.delete(task),
      () => inFlight.delete(task),
    );
  }

  /**
   * Reads the next chunk step and wraps source failures as STREAM_ERROR.
   * @private
   */
  async _readNextStoreChunk({ iterator, sem, inFlight, orphanedBlobs, nextIndex }) {
    try {
      return await iterator.next();
    } catch (err) {
      sem.release();
      await Promise.allSettled(inFlight);
      await this._closeAsyncIterator(iterator);
      throw this._buildStoreStreamError(err, nextIndex, orphanedBlobs);
    }
  }

  /**
   * Finalizes in-flight writes and rethrows the first write failure, if any.
   * @private
   */
  async _awaitChunkWrites({ inFlight, state, orphanedBlobs }) {
    const settled = await Promise.allSettled(inFlight);
    if (state.writeError) {
      throw this._buildStoreWriteError({
        err: state.writeError,
        nextIndex: state.nextIndex,
        orphanedBlobs,
        failedIndex: state.failedIndex,
      });
    }
    for (const result of settled) {
      if (result.status !== 'fulfilled') {
        throw this._buildStoreWriteError({
          err: result.reason,
          nextIndex: state.nextIndex,
          orphanedBlobs,
          failedIndex: state.failedIndex,
        });
      }
    }
  }

  /**
   * Appends chunk entries to the manifest accumulator in index order.
   * @private
   */
  _appendChunkEntries(manifestData, results) {
    for (const entry of results) {
      manifestData.chunks.push(entry);
      manifestData.size += entry.size;
    }
  }

  /**
   * Closes an async iterator if it supports early termination.
   * @private
   */
  async _closeAsyncIterator(iterator) {
    if (typeof iterator.return !== 'function') {
      return;
    }
    try {
      await iterator.return();
    } catch {
      // Prefer surfacing the original store failure.
    }
  }

  /**
   * Normalizes store-stream failures and annotates them with orphaned blobs.
   * @private
   */
  _buildStoreStreamError(err, nextIndex, orphanedBlobs) {
    if (err instanceof CasError) {
      err.meta = { ...err.meta, orphanedBlobs };
      return err;
    }

    const casErr = new CasError(
      `Stream error during store: ${err.message}`,
      'STREAM_ERROR',
      { chunksDispatched: nextIndex, orphanedBlobs, originalError: err },
    );
    this.observability.metric('error', {
      code: casErr.code, message: casErr.message,
      orphanedBlobs: orphanedBlobs.length,
    });
    return casErr;
  }

  /**
   * Normalizes chunk-write failures and annotates them with write-phase state.
   * @private
   */
  _buildStoreWriteError({ err, nextIndex, orphanedBlobs, failedIndex }) {
    const writeMeta = {
      chunksDispatched: nextIndex,
      orphanedBlobs,
      ...(failedIndex === null ? {} : { failedIndex }),
    };

    if (err instanceof CasError) {
      err.meta = { ...err.meta, ...writeMeta };
      return err;
    }

    const casErr = new CasError(
      `Store write failed: ${err.message}`,
      'STORE_ERROR',
      { ...writeMeta, originalError: err },
    );
    this.observability.metric('error', {
      code: casErr.code,
      message: casErr.message,
      orphanedBlobs: orphanedBlobs.length,
      ...(failedIndex === null ? {} : { failedIndex }),
    });
    return casErr;
  }

  /**
   * Encrypts a buffer using AES-256-GCM.
   * @param {Object} options
   * @param {Uint8Array} options.buffer - Plaintext data to encrypt.
   * @param {Uint8Array} options.key - 32-byte encryption key.
   * @returns {Promise<{ buf: Uint8Array, meta: { algorithm: string, nonce: string, tag: string, encrypted: boolean } }>}
   * @throws {CasError} INVALID_KEY_TYPE | INVALID_KEY_LENGTH if the key is invalid.
   */
  async encrypt({ buffer, key }) {
    return await this.crypto.encryptBuffer(buffer, key);
  }

  /**
   * Decrypts a buffer. Returns the buffer unchanged if `meta.encrypted` is falsy.
   * @param {Object} options
   * @param {Uint8Array} options.buffer - Ciphertext to decrypt.
   * @param {Uint8Array} options.key - 32-byte encryption key.
   * @param {{ encrypted: boolean, algorithm: string, nonce: string, tag: string }} options.meta - Encryption metadata from the manifest.
   * @returns {Promise<Uint8Array>} Decrypted plaintext.
   * @throws {CasError} INTEGRITY_ERROR if authentication tag verification fails.
   */
  async decrypt({ buffer, key, meta }) {
    if (!meta?.encrypted) {
      return buffer;
    }
    try {
      return await this.crypto.decryptBuffer(buffer, key, meta);
    } catch (err) {
      if (err instanceof CasError) {throw err;}
      throw new CasError('Decryption failed: Integrity check error', 'INTEGRITY_ERROR', { originalError: err });
    }
  }

  /**
   * Decrypts a buffer with optional AAD. Used internally for v2 schemes.
   * @private
   * @param {Object} options
   * @param {Uint8Array} options.buffer - Ciphertext to decrypt.
   * @param {Uint8Array} options.key - 32-byte encryption key.
   * @param {{ encrypted: boolean, algorithm: string, nonce: string, tag: string }} options.meta - Encryption metadata.
   * @param {Uint8Array} [options.aad] - Optional additional authenticated data.
   * @returns {Promise<Uint8Array>} Decrypted plaintext.
   * @throws {CasError} INTEGRITY_ERROR if authentication tag verification fails.
   */
  async _decryptWithAad({ buffer, key, meta, aad }) {
    if (!meta?.encrypted) {
      return buffer;
    }
    try {
      return await this.crypto.decryptBuffer(buffer, key, meta, aad);
    } catch (err) {
      if (err instanceof CasError) {throw err;}
      throw new CasError('Decryption failed: Integrity check error', 'INTEGRITY_ERROR', { originalError: err });
    }
  }

  /**
   * Resolves the requested store encryption config.
   * @private
   * @param {{ scheme?: string, frameBytes?: number, convergent?: boolean }} [encryption]
   * @param {boolean} hasEncryptionKey
   * @returns {undefined|{ scheme: 'whole' }|{ scheme: 'framed', frameBytes: number }|{ scheme: 'convergent' }}
   */
  _resolveStoreEncryptionConfig(encryption, hasEncryptionKey) {
    const scheme = encryption?.scheme;
    const frameBytes = encryption?.frameBytes;
    this._assertStoreEncryptionPrereqs({ hasEncryptionKey, scheme, frameBytes });

    if (!hasEncryptionKey) {
      return undefined;
    }

    if (scheme === SCHEME_CONVERGENT) {
      return { scheme: SCHEME_CONVERGENT };
    }

    if (scheme === SCHEME_WHOLE) {
      return { scheme: SCHEME_WHOLE };
    }

    if (scheme === SCHEME_FRAMED) {
      return this._resolveFramedStoreEncryptionConfig(frameBytes);
    }

    if (!scheme) {
      return this._resolveAutoEncryptionScheme(encryption, frameBytes);
    }

    throw new CasError(
      `Unsupported encryption scheme: ${scheme}`,
      'INVALID_OPTIONS',
      { scheme },
    );
  }

  /**
   * Auto-selects encryption scheme when none is explicitly requested.
   * Defaults to convergent for CDC chunking (unless opted out),
   * otherwise framed.
   * @private
   * @param {{ convergent?: boolean }} [encryption]
   * @param {number|undefined} frameBytes
   * @returns {{ scheme: 'convergent' }|{ scheme: 'framed', frameBytes: number }}
   */
  _resolveAutoEncryptionScheme(encryption, frameBytes) {
    const convergentExplicit = encryption?.convergent;
    if (convergentExplicit === true || (convergentExplicit !== false && this.chunker.strategy === 'cdc')) {
      return { scheme: SCHEME_CONVERGENT };
    }
    return this._resolveFramedStoreEncryptionConfig(frameBytes);
  }

  /**
   * Validates that store-time encryption options are coherent.
   * @private
   * @param {{ hasEncryptionKey: boolean, scheme?: string, frameBytes?: number }} options
   */
  _assertStoreEncryptionPrereqs({ hasEncryptionKey, scheme, frameBytes }) {
    if (!hasEncryptionKey && (scheme || frameBytes !== undefined)) {
      throw new CasError(
        'encryption options require encryptionKey, passphrase, or recipients',
        'INVALID_OPTIONS',
        { scheme, frameBytes },
      );
    }

    if (frameBytes !== undefined && scheme === SCHEME_WHOLE) {
      throw new CasError(
        `encryption.frameBytes is not supported for ${scheme} stores`,
        'INVALID_OPTIONS',
        { scheme, frameBytes },
      );
    }
  }

  /**
   * Normalizes framed store config.
   * @private
   * @param {number|undefined} frameBytes
   * @returns {{ scheme: 'framed', frameBytes: number }}
   */
  _resolveFramedStoreEncryptionConfig(frameBytes) {
    const normalizedFrameBytes = frameBytes ?? DEFAULT_FRAMED_FRAME_BYTES;
    if (!Number.isInteger(normalizedFrameBytes) || normalizedFrameBytes < 1) {
      throw new CasError(
        'encryption.frameBytes must be a positive integer',
        'INVALID_OPTIONS',
        { frameBytes: normalizedFrameBytes },
      );
    }
    if (normalizedFrameBytes > MAX_FRAMED_FRAME_BYTES) {
      throw new CasError(
        `encryption.frameBytes must not exceed ${MAX_FRAMED_FRAME_BYTES} bytes (64 MiB), got ${normalizedFrameBytes}`,
        'INVALID_OPTIONS',
        { frameBytes: normalizedFrameBytes, max: MAX_FRAMED_FRAME_BYTES },
      );
    }

    return {
      scheme: SCHEME_FRAMED,
      frameBytes: normalizedFrameBytes,
    };
  }

  /**
   * Treats manifest encryption metadata as security-critical when present.
   * @private
   * @param {{ slug?: string, encryption?: { scheme?: string, encrypted?: boolean, algorithm?: string, nonce?: string, tag?: string, frameBytes?: number } }} manifest
   * @returns {undefined|({ scheme: 'whole', encrypted: true, algorithm: 'aes-256-gcm', nonce: string, tag: string }|{ scheme: 'framed', encrypted: true, algorithm: 'aes-256-gcm', frameBytes: number }|{ scheme: 'convergent', encrypted: true, algorithm: 'aes-256-gcm' })}
   * @throws {CasError} INTEGRITY_ERROR if encryption metadata was downgraded or tampered.
   */
  _validatedEncryptionMeta(manifest) {
    const meta = manifest.encryption;
    if (!meta) {
      return undefined;
    }
    this._validateCommonEncryptedManifestMeta(manifest, meta);

    if (meta.scheme === SCHEME_WHOLE) {
      return this._validateWholeEncryptionMeta(manifest, meta);
    }

    if (meta.scheme === SCHEME_FRAMED) {
      return this._validateFramedEncryptionMeta(manifest, meta);
    }

    if (meta.scheme === SCHEME_CONVERGENT) {
      return this._validateConvergentEncryptionMeta(manifest, meta);
    }

    throw new CasError(
      `Encrypted manifest uses unknown scheme: ${meta.scheme}`,
      'INTEGRITY_ERROR',
      { slug: manifest.slug, reason: 'manifest-encryption-scheme', scheme: meta.scheme },
    );
  }

  /**
   * Validates common encrypted-manifest fields.
   * @private
   * @param {{ slug?: string }} manifest
   * @param {{ encrypted?: boolean, algorithm?: string }} meta
   */
  _validateCommonEncryptedManifestMeta(manifest, meta) {
    if (meta.encrypted !== true) {
      throw new CasError(
        'Encrypted manifest metadata was downgraded or is invalid',
        'INTEGRITY_ERROR',
        { slug: manifest.slug, reason: 'manifest-encryption-downgrade' },
      );
    }

    if (meta.algorithm !== 'aes-256-gcm') {
      throw new CasError(
        `Encrypted manifest uses unexpected algorithm: ${meta.algorithm}`,
        'INTEGRITY_ERROR',
        { slug: manifest.slug, reason: 'manifest-encryption-algorithm', algorithm: meta.algorithm },
      );
    }
  }

  /**
   * Validates whole manifest metadata.
   * @private
   * @param {{ slug?: string }} manifest
   * @param {{ nonce?: string, tag?: string }} meta
   * @returns {{ scheme: 'whole', encrypted: true, algorithm: 'aes-256-gcm', nonce: string, tag: string }}
   */
  _validateWholeEncryptionMeta(manifest, meta) {
    if (typeof meta.nonce !== 'string' || meta.nonce.length === 0 || typeof meta.tag !== 'string' || meta.tag.length === 0) {
      throw new CasError(
        'Whole encrypted manifest is missing nonce/tag metadata',
        'INTEGRITY_ERROR',
        { slug: manifest.slug, reason: 'manifest-encryption-meta' },
      );
    }

    return /** @type {{ scheme: 'whole', encrypted: true, algorithm: 'aes-256-gcm', nonce: string, tag: string }} */ ({
      ...meta,
      scheme: SCHEME_WHOLE,
    });
  }

  /**
   * Validates framed manifest metadata.
   * @private
   * @param {{ slug?: string }} manifest
   * @param {{ frameBytes?: number }} meta
   * @returns {{ scheme: 'framed', encrypted: true, algorithm: 'aes-256-gcm', frameBytes: number }}
   */
  _validateFramedEncryptionMeta(manifest, meta) {
    if (!Number.isInteger(meta.frameBytes) || meta.frameBytes < 1) {
      throw new CasError(
        'Framed encrypted manifest is missing a valid frameBytes value',
        'INTEGRITY_ERROR',
        { slug: manifest.slug, reason: 'manifest-encryption-frame-bytes', frameBytes: meta.frameBytes },
      );
    }

    return /** @type {{ scheme: 'framed', encrypted: true, algorithm: 'aes-256-gcm', frameBytes: number }} */ ({
      ...meta,
      scheme: SCHEME_FRAMED,
      frameBytes: meta.frameBytes,
    });
  }

  /**
   * Validates convergent manifest metadata.
   * @private
   * @param {{ slug?: string }} manifest
   * @param {{ scheme: 'convergent' }} meta
   * @returns {{ scheme: 'convergent', encrypted: true, algorithm: 'aes-256-gcm' }}
   */
  _validateConvergentEncryptionMeta(_manifest, meta) {
    return /** @type {{ scheme: 'convergent', encrypted: true, algorithm: 'aes-256-gcm' }} */ ({
      ...meta,
      scheme: SCHEME_CONVERGENT,
    });
  }

  /**
   * Emits a normalized integrity failure event/metric.
   * @private
   * @param {{ slug?: string }} manifest
   * @param {Record<string, unknown>} [extra]
   */
  _emitIntegrityFail(manifest, extra = {}) {
    this.observability.metric('integrity', {
      action: 'fail',
      slug: manifest.slug,
      ...extra,
    });
  }

  /**
   * Validates encryption metadata for verifyIntegrity(), returning false on
   * integrity-style manifest failures without throwing.
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @returns {false|undefined|({ scheme: 'whole', encrypted: true, algorithm: 'aes-256-gcm', nonce: string, tag: string }|{ scheme: 'framed', encrypted: true, algorithm: 'aes-256-gcm', frameBytes: number }|{ scheme: 'convergent', encrypted: true, algorithm: 'aes-256-gcm' })}
   */
  _getVerifyEncryptionMeta(manifest) {
    try {
      return this._validatedEncryptionMeta(manifest);
    } catch (err) {
      if (err instanceof CasError && err.code === 'INTEGRITY_ERROR') {
        this._emitIntegrityFail(manifest, err.meta);
        return false;
      }
      throw err;
    }
  }

  /**
   * Verifies chunk digests and collects buffers for any later auth step.
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @returns {Promise<false|Uint8Array[]>}
   */
  async _verifyChunkDigests(manifest) {
    const buffers = [];
    for (const chunk of manifest.chunks) {
      const blob = await this._readChunkBlob(chunk.blob);
      const digest = await this._sha256(blob);
      if (digest !== chunk.digest) {
        this._emitIntegrityFail(manifest, {
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

  /**
   * Resolves the decryption key for restore-style operations.
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @param {Uint8Array} [encryptionKey]
   * @param {string} [passphrase]
   * @returns {Promise<Uint8Array|undefined>}
   */
  async _resolveRestoreKey(manifest, encryptionKey, passphrase) {
    return await this.#keyResolver.resolveForDecryption(
      manifest,
      encryptionKey,
      passphrase,
    );
  }

  /**
   * Resolves a verification key for encrypted content without throwing on
   * auth-style failures.
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @param {{ encryptionKey?: Uint8Array, passphrase?: string }} options
   * @returns {Promise<false|Uint8Array>}
   */
  async _resolveVerifyKey(manifest, options) {
    try {
      return await this.#keyResolver.resolveForDecryption(
        manifest,
        options.encryptionKey,
        options.passphrase,
      );
    } catch (err) {
      if (err instanceof CasError && ['MISSING_KEY', 'NO_MATCHING_RECIPIENT', 'DEK_UNWRAP_FAILED'].includes(err.code)) {
        this._emitIntegrityFail(manifest, { reason: 'auth', code: err.code });
        return false;
      }
      throw err;
    }
  }

  /**
   * Authenticates whole encrypted content during verifyIntegrity().
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @param {{ encrypted: true, algorithm: 'aes-256-gcm', nonce: string, tag: string }} encryptionMeta
   * @param {Uint8Array} key
   * @param {Uint8Array[]} buffers
   * @returns {Promise<boolean>}
   */
  async _verifyEncryptedAuth({ manifest, encryptionMeta, key, buffers }) {
    try {
      const aad = this._isLegacyNoAad(manifest)
        ? undefined
        : buildWholeAad(manifest.slug);
      await this._decryptWithAad({
        buffer: concatBytes(buffers),
        key,
        meta: encryptionMeta,
        aad,
      });
      return true;
    } catch (err) {
      if (err instanceof CasError && err.code === 'INTEGRITY_ERROR') {
        this._emitIntegrityFail(manifest, { reason: 'auth', code: err.code });
        return false;
      }
      throw err;
    }
  }

  /**
   * Authenticates framed encrypted content during verifyIntegrity().
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @param {{ encrypted: true, algorithm: 'aes-256-gcm', frameBytes: number }} encryptionMeta
   * @param {Uint8Array} key
   * @param {Uint8Array[]} buffers
   * @returns {Promise<boolean>}
   */
  async _verifyFramedAuth({ manifest, encryptionMeta, key, buffers }) {
    try {
      const source = (async function* framedSource() {
        for (const buffer of buffers) {
          yield buffer;
        }
      })();

      const noAad = this._isLegacyNoAad(manifest);
      let frameIndex = 0;
      for await (const record of this._parseFramedRecords(source, encryptionMeta.frameBytes)) {
        const aad = noAad ? undefined : buildFramedAad(manifest.slug, frameIndex);
        await this._decryptWithAad({
          buffer: record.ciphertext,
          key,
          meta: record.meta,
          aad,
        });
        frameIndex++;
      }

      return true;
    } catch (err) {
      if (err instanceof CasError && err.code === 'INTEGRITY_ERROR') {
        this._emitIntegrityFail(manifest, {
          reason: err.meta?.reason === 'framed-record-parse' ? 'framing' : 'auth',
          code: err.code,
          ...err.meta,
        });
        return false;
      }
      throw err;
    }
  }

  /**
   * Wraps an async iterable through gzip compression.
   * @private
   * @param {AsyncIterable<Uint8Array>} source
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *_compressStream(source) {
    yield* this.compressionAdapter.compressStream(source);
  }

  /**
   * Validates and normalizes compression options.
   * @private
   */
  _validateCompression(compression) {
    if (compression?.algorithm && compression.algorithm !== 'gzip') {
      throw new CasError(
        `Unsupported compression algorithm: ${compression.algorithm}`,
        'INVALID_OPTIONS',
      );
    }
  }

  /**
   * Validates that a chunking strategy is recognized.
   * @param {Object} [chunking] - Chunking options from a manifest.
   * @throws {CasError} INVALID_CHUNKING_STRATEGY if the strategy is unrecognized.
   * @private
   */
  _validateChunking(chunking) {
    if (!chunking) { return; }
    const validStrategies = ['fixed', 'cdc'];
    if (!validStrategies.includes(chunking.strategy)) {
      throw new CasError(
        `Unsupported chunking strategy: ${chunking.strategy}`,
        'INVALID_CHUNKING_STRATEGY',
        { strategy: chunking.strategy },
      );
    }
  }

  /**
   * Chunks an async iterable source and stores it in Git.
   *
   * Supports two encryption modes: direct key/passphrase or envelope encryption
   * via `recipients` (DEK/KEK model). The modes are mutually exclusive.
   *
   * @param {Object} options
   * @param {AsyncIterable<Uint8Array>} options.source
   * @param {string} options.slug
   * @param {string} options.filename
   * @param {Uint8Array} [options.encryptionKey]
   * @param {string} [options.passphrase] - Derive encryption key from passphrase instead.
   * @param {{ scheme?: 'whole'|'framed'|'convergent', frameBytes?: number }} [options.encryption] - Explicit encryption scheme selection.
   * @param {Object} [options.kdfOptions] - KDF options when using passphrase.
   * @param {{ algorithm: 'gzip' }} [options.compression] - Enable compression.
   * @param {Array<{label: string, key: Uint8Array}>} [options.recipients] - Envelope recipients (mutually exclusive with encryptionKey/passphrase).
   * @returns {Promise<import('../value-objects/Manifest.js').default>}
   */
  async store({ source, slug, filename, encryptionKey, passphrase, encryption, kdfOptions, compression, recipients }) {
    if (!source || typeof source[Symbol.asyncIterator] !== 'function') {
      throw new CasError('source must be an async iterable', 'INVALID_OPTIONS', { sourceType: typeof source });
    }
    if (recipients && (encryptionKey || passphrase)) {
      throw new CasError('Provide recipients or encryptionKey/passphrase, not both', 'INVALID_OPTIONS');
    }
    KeyResolver.validateKeySourceExclusive(encryptionKey, passphrase);
    this._validateCompression(compression);

    const keyInfo = recipients
      ? await this.#keyResolver.resolveRecipients(recipients)
      : await this.#keyResolver.resolveForStore(encryptionKey, passphrase, kdfOptions);
    const encryptionConfig = this._resolveStoreEncryptionConfig(encryption, !!keyInfo.key);

    const manifestData = this._buildManifestData(slug, filename, compression);
    const processedSource = compression ? this._compressStream(source) : source;

    await this._dispatchStore({ processedSource, manifestData, keyInfo, encryptionConfig });

    const manifest = new Manifest(manifestData);
    this.observability.metric('file', {
      action: 'stored', slug, size: manifest.size, chunkCount: manifest.chunks.length, encrypted: !!keyInfo.key,
    });
    return manifest;
  }

  /**
   * Routes to the correct store strategy based on encryption config.
   * @private
   * @param {{ processedSource: AsyncIterable<Uint8Array>, manifestData: Object, keyInfo: { key?: Uint8Array, encExtra: Object }, encryptionConfig?: Object }} options
   */
  async _dispatchStore({ processedSource, manifestData, keyInfo, encryptionConfig }) {
    if (keyInfo.key && encryptionConfig?.scheme === SCHEME_CONVERGENT) {
      await this._storeConvergentSource(processedSource, manifestData, keyInfo);
      return;
    }
    if (keyInfo.key) {
      this._warnEncryptedCdc();
      await this._storeEncryptedSource({
        processedSource, manifestData, key: keyInfo.key,
        encryptionConfig, encExtra: keyInfo.encExtra,
      });
      return;
    }
    await this._chunkAndStore(processedSource, manifestData);
  }

  /**
   * Stores content using convergent per-chunk encryption.
   * @private
   * @param {AsyncIterable<Uint8Array>} processedSource
   * @param {Object} manifestData
   * @param {{ key: Uint8Array, encExtra: Object }} keyInfo
   */
  async _storeConvergentSource(processedSource, manifestData, keyInfo) {
    await this._chunkAndStore(processedSource, manifestData, { convergentKey: keyInfo.key });
    manifestData.encryption = {
      scheme: SCHEME_CONVERGENT,
      algorithm: 'aes-256-gcm',
      encrypted: true,
      ...keyInfo.encExtra,
    };
  }

  /**
   * Warns when encrypted content is stored through CDC chunking.
   * @private
   */
  _warnEncryptedCdc() {
    if (this.chunker.strategy !== 'cdc') {
      return;
    }

    this.observability.log(
      'warn',
      'CDC deduplication is ineffective with encryption — ciphertext is pseudorandom',
      { strategy: 'cdc' },
    );
  }

  /**
   * Stores encrypted content using the requested scheme.
   * @private
   * @param {{ processedSource: AsyncIterable<Uint8Array>, manifestData: { encryption?: object }, key: Uint8Array, encryptionConfig: { scheme: 'whole' }|{ scheme: 'framed', frameBytes: number }, encExtra: Record<string, unknown> }} options
   */
  async _storeEncryptedSource({ processedSource, manifestData, key, encryptionConfig, encExtra }) {
    if (encryptionConfig.scheme === SCHEME_FRAMED) {
      await this._chunkAndStore(
        this._encryptFramed(processedSource, key, {
          frameBytes: encryptionConfig.frameBytes,
          slug: manifestData.slug,
        }),
        manifestData,
      );
      manifestData.encryption = {
        scheme: SCHEME_FRAMED,
        algorithm: 'aes-256-gcm',
        encrypted: true,
        frameBytes: encryptionConfig.frameBytes,
        ...encExtra,
      };
      return;
    }

    const aad = buildWholeAad(manifestData.slug);
    const { encrypt, finalize } = this.crypto.createEncryptionStream(key, aad);
    await this._chunkAndStore(encrypt(processedSource), manifestData);
    manifestData.encryption = {
      ...finalize(),
      scheme: SCHEME_WHOLE,
      ...encExtra,
    };
  }

  /**
   * Builds initial manifest data with optional chunking and compression metadata.
   * @private
   */
  _buildManifestData(slug, filename, compression) {
    const data = { slug, filename, size: 0, chunks: [] };
    if (this.formatVersion) { data.formatVersion = this.formatVersion; }
    if (this.chunker.strategy !== 'fixed') {
      data.chunking = { strategy: this.chunker.strategy, params: this.chunker.params };
    }
    if (compression) { data.compression = { algorithm: 'gzip' }; }
    return data;
  }

  /**
   * Builds AAD for the current frame in framed encryption.
   * @private
   * @param {string} slug
   * @param {number} frameIndex
   * @returns {Uint8Array}
   */
  _buildFrameAad(slug, frameIndex) {
    return buildFramedAad(slug, frameIndex);
  }

  /**
   * Returns true when a manifest was read in legacy mode from a v1
   * scheme that did not use AAD.
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @returns {boolean}
   */
  _isLegacyNoAad(manifest) {
    if (!this.#legacyMode) { return false; }
    if (!originalSchemeMap.has(manifest)) { return false; }
    const orig = originalSchemeMap.get(manifest);
    // undefined means schemeless legacy — no AAD, same as whole-v1
    return orig === undefined || isLegacyNoAad(orig);
  }

  /**
   * Encrypts plaintext frames independently and serializes them into framed
   * records.
   * @private
   * @param {AsyncIterable<Uint8Array>} source
   * @param {Uint8Array} key
   * @param {{ frameBytes: number, slug: string }} opts
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *_encryptFramed(source, key, { frameBytes, slug }) {
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
        yield await this._serializeFramedRecord(frame, key, this._buildFrameAad(slug, frameIndex));
        frameIndex++;
      }
    }

    if (pending.length > 0) {
      yield await this._serializeFramedRecord(pending, key, this._buildFrameAad(slug, frameIndex));
      return;
    }

    if (!sawPlaintext) {
      yield await this._serializeFramedRecord(new Uint8Array(0), key, this._buildFrameAad(slug, frameIndex));
    }
  }

  /**
   * Serializes one framed record.
   * @private
   * @param {Uint8Array} frame
   * @param {Uint8Array} key
   * @param {Uint8Array} [aad] - AAD for framed encryption.
   * @returns {Promise<Uint8Array>}
   */
  async _serializeFramedRecord(frame, key, aad) {
    const { buf, meta } = await this.crypto.encryptBuffer(frame, key, aad);
    const nonce = decodeBase64(meta.nonce);
    const tag = decodeBase64(meta.tag);
    const header = new Uint8Array(FRAMED_RECORD_HEADER_BYTES);
    writeUint32BE(header, 0, buf.length);
    header.set(nonce, FRAMED_LENGTH_BYTES);
    header.set(tag, FRAMED_LENGTH_BYTES + GCM_NONCE_BYTES);
    return concatBytes([header, buf]);
  }

  /**
   * Builds unique chunk blob tree entries in first-seen order.
   *
   * Tree entries keep chunk blobs reachable in Git. The manifest remains the
   * authoritative ordered list of chunk occurrences, so repeated digests only
   * need one tree entry.
   *
   * @private
   * @param {import('../value-objects/Chunk.js').default[]} chunks
   * @returns {string[]}
   */
  _createChunkTreeEntries(chunks) {
    const treeEntries = [];
    const seenDigests = new Set();

    for (const chunk of chunks) {
      if (seenDigests.has(chunk.digest)) {
        continue;
      }
      seenDigests.add(chunk.digest);
      treeEntries.push(`100644 blob ${chunk.blob}\t${chunk.digest}`);
    }

    return treeEntries;
  }

  /**
   * Creates a Git tree object from a manifest.
   *
   * The tree contains the serialized manifest file and one blob entry per
   * unique chunk digest, preserving first-seen order.
   *
   * @param {Object} options
   * @param {import('../value-objects/Manifest.js').default} options.manifest - The file manifest.
   * @returns {Promise<string>} Git OID of the created tree.
   */
  async createTree({ manifest }) {
    const chunks = manifest.chunks;

    if (chunks.length > this.merkleThreshold) {
      return await this._createMerkleTree({ manifest });
    }

    const manifestData = manifest.toJSON();
    const hashableBytes = encodeForHash(manifestData, this.codec);
    manifestData.manifestHash = await this.crypto.sha256(hashableBytes);
    const serializedManifest = normalizeCodecBytes(this.codec.encode(manifestData));
    const manifestOid = await this.persistence.writeBlob(serializedManifest);

    const treeEntries = [
      `100644 blob ${manifestOid}\tmanifest.${this.codec.extension}`,
      ...this._createChunkTreeEntries(chunks),
    ];

    return await this.persistence.writeTree(treeEntries);
  }

  /**
   * Creates a Merkle tree by splitting chunks into sub-manifests.
   * @private
   * @param {Object} options
   * @param {import('../value-objects/Manifest.js').default} options.manifest
   * @returns {Promise<string>} Git tree OID.
   */
  async _createMerkleTree({ manifest }) {
    const chunks = [...manifest.chunks];
    const subManifestRefs = [];

    for (let i = 0; i < chunks.length; i += this.merkleThreshold) {
      const group = chunks.slice(i, i + this.merkleThreshold);
      const subManifestData = { chunks: group.map((c) => ({ index: c.index, size: c.size, digest: c.digest, blob: c.blob })) };
      const serialized = normalizeCodecBytes(this.codec.encode(subManifestData));
      const oid = await this.persistence.writeBlob(serialized);

      subManifestRefs.push({
        oid,
        chunkCount: group.length,
        startIndex: i,
      });
    }

    const rootManifestData = {
      ...manifest.toJSON(),
      version: 2,
      chunks: [],
      subManifests: subManifestRefs,
    };
    const rootHashableBytes = encodeForHash(rootManifestData, this.codec);
    rootManifestData.manifestHash = await this.crypto.sha256(rootHashableBytes);

    const serializedRoot = normalizeCodecBytes(this.codec.encode(rootManifestData));
    const rootOid = await this.persistence.writeBlob(serializedRoot);

    const subManifestEntries = subManifestRefs.map(
      (ref, idx) => `100644 blob ${ref.oid}\tsub-manifest-${idx}.${this.codec.extension}`,
    );

    const treeEntries = [
      `100644 blob ${rootOid}\tmanifest.${this.codec.extension}`,
      ...subManifestEntries,
      ...this._createChunkTreeEntries(chunks),
    ];

    return await this.persistence.writeTree(treeEntries);
  }

  /**
   * Reads a single chunk blob from Git and verifies its SHA-256 digest.
   * @private
   * @param {{ index: number, size: number, digest: string, blob: string }} chunk - Chunk metadata.
   * @returns {Promise<Uint8Array>} Verified chunk buffer.
   * @throws {CasError} INTEGRITY_ERROR if the chunk digest does not match.
   */
  async _readAndVerifyChunk(chunk, { maxBytes, convergentKey } = {}) {
    const rawBlob = await this._readChunkBlob(chunk.blob, { maxBytes });

    if (convergentKey) {
      return this.#convergent.decryptAndVerifyChunk({
        blob: rawBlob, masterKey: convergentKey, expectedDigest: chunk.digest, chunkIndex: chunk.index,
      });
    }

    const digest = await this._sha256(rawBlob);
    if (digest !== chunk.digest) {
      const err = new CasError(
        `Chunk ${chunk.index} integrity check failed`,
        'INTEGRITY_ERROR',
        { chunkIndex: chunk.index, expected: chunk.digest, actual: digest },
      );
      this.observability.metric('error', { code: err.code, message: err.message });
      throw err;
    }
    return rawBlob;
  }

  /**
   * Reads a chunk blob, preferring stream-native reads when supported.
   * Falls back to readBlob() for compatibility with older adapters and mocks.
   *
   * @private
   * @param {string} oid - Chunk blob OID.
   * @returns {Promise<Uint8Array>}
   */
  async _readChunkBlob(oid, { maxBytes } = {}) {
    if (!this._supportsReadBlobStream()) {
      if (maxBytes !== undefined) {
        throw new CasError(
          'Buffered restore safety requires persistence.readBlobStream()',
          'PERSISTENCE_CAPABILITY_REQUIRED',
          { capability: 'readBlobStream', mode: 'buffered-restore', oid },
        );
      }
      const blob = await this.persistence.readBlob(oid);
      return blob;
    }
    let total = 0;
    const chunks = [];
    for await (const chunk of await this.persistence.readBlobStream(oid)) {
      const buf = normalizeByteChunk(chunk);
      total += buf.length;
      this._assertBufferedReadLimit({ size: total, limit: maxBytes, oid });
      chunks.push(buf);
    }
    return concatBytes(chunks);
  }

  /**
   * Whether the persistence adapter exposes a concrete readBlobStream()
   * implementation instead of the abstract port stub.
   * @private
   * @returns {boolean}
   */
  _supportsReadBlobStream() {
    return typeof this.persistence.readBlobStream === 'function'
      && this.persistence.readBlobStream !== GitPersistencePort.prototype.readBlobStream;
  }

  /**
   * Reads chunk blobs from Git and verifies their SHA-256 digests.
   * @private
   * @param {import('../value-objects/Chunk.js').default[]} chunks - Chunk metadata from the manifest.
   * @returns {Promise<Uint8Array[]>} Verified chunk buffers in order.
   * @throws {CasError} INTEGRITY_ERROR if any chunk digest does not match.
   */
  async _readAndVerifyChunks(chunks, { totalLimit } = {}) {
    const buffers = [];
    let totalRead = 0;
    for (const chunk of chunks) {
      const blob = await this._readAndVerifyChunk(chunk, {
        maxBytes: this._bufferedChunkReadLimit({
          totalLimit,
          totalRead,
          chunkSize: chunk.size,
        }),
      });
      totalRead += blob.length;
      buffers.push(blob);
      this.observability.metric('chunk', { action: 'restored', index: chunk.index, size: blob.length, digest: chunk.digest });
    }
    return buffers;
  }

  /**
   * Throws when a buffered read exceeds its allowed limit.
   * @private
   * @param {{ size: number, limit?: number, oid: string }} options
   */
  _assertBufferedReadLimit({ size, limit, oid }) {
    if (limit === undefined || size <= limit) {
      return;
    }
    throw new CasError(
      `Buffered restore read ${size} bytes from blob ${oid} (limit: ${limit})`,
      'RESTORE_TOO_LARGE',
      { size, limit, oid, reason: 'chunk-blob-size' },
    );
  }

  /**
   * Computes the per-chunk buffered read limit from the remaining global budget
   * and manifest-declared chunk size.
   * @private
   * @param {{ totalLimit?: number, totalRead: number, chunkSize: number }} options
   * @returns {number|undefined}
   */
  _bufferedChunkReadLimit({ totalLimit, totalRead, chunkSize }) {
    if (totalLimit === undefined) {
      return chunkSize;
    }
    return Math.min(chunkSize, totalLimit - totalRead);
  }

  /**
   * Restores a file from its manifest by reading and reassembling chunks.
   *
   * If the manifest has encryption metadata, decrypts the reassembled
   * ciphertext using the provided key.
   *
   * @param {Object} options
   * @param {import('../value-objects/Manifest.js').default} options.manifest - The file manifest.
   * @param {Uint8Array} [options.encryptionKey] - 32-byte key, required if manifest is encrypted.
   * @param {string} [options.passphrase] - Passphrase for KDF-based decryption.
   * @returns {Promise<{ buffer: Uint8Array, bytesWritten: number }>}
   * @throws {CasError} MISSING_KEY if manifest is encrypted but no key is provided.
   * @throws {CasError} INTEGRITY_ERROR if chunk verification or decryption fails.
   */
  async restore({ manifest, encryptionKey, passphrase }) {
    const chunks = [];
    for await (const chunk of this.restoreStream({ manifest, encryptionKey, passphrase })) {
      chunks.push(chunk);
    }
    const buffer = concatBytes(chunks);
    return { buffer, bytesWritten: buffer.length };
  }

  /**
   * Creates a named restore plan for file publication without leaking
   * underscore helper coupling into infrastructure adapters.
   *
   * `stream` plans can be piped directly to the destination file. `bounded-file`
   * plans preserve the whole-object auth boundary by writing to a temp file and
   * only publishing on success.
   *
   * @param {Object} options
   * @param {import('../value-objects/Manifest.js').default} options.manifest
   * @param {Uint8Array} [options.encryptionKey]
   * @param {string} [options.passphrase]
   * @returns {Promise<{ mode: 'stream'|'bounded-file', source: AsyncIterable<Uint8Array>, encryptionMeta?: import('../value-objects/Manifest.js').EncryptionMeta }>}
   */
  async createFileRestorePlan({ manifest, encryptionKey, passphrase }) {
    const encryptionMeta = this._validatedEncryptionMeta(manifest);

    if (this._shouldUseBufferedFileRestore(manifest, encryptionMeta)) {
      return {
        mode: 'bounded-file',
        source: await this._createBufferedFileRestoreSource({
          manifest,
          encryptionKey,
          passphrase,
          encryptionMeta,
        }),
        encryptionMeta,
      };
    }

    return {
      mode: 'stream',
      source: this.restoreStream({ manifest, encryptionKey, passphrase }),
      encryptionMeta,
    };
  }

  /**
   * Restores a file from its manifest as an async iterable of Uint8Array chunks.
   *
   * For unencrypted, uncompressed files this is true per-chunk streaming with
   * O(chunkSize) memory. `whole` encrypted paths still collect internally
   * before yielding, while `framed` encrypted payloads authenticate and
   * emit plaintext incrementally.
   *
   * @param {Object} options
   * @param {import('../value-objects/Manifest.js').default} options.manifest - The file manifest.
   * @param {Uint8Array} [options.encryptionKey] - 32-byte key, required if manifest is encrypted.
   * @param {string} [options.passphrase] - Passphrase for KDF-based decryption.
   * Note: For unencrypted files, each yielded buffer corresponds to an original
   * stored chunk. For buffered restore paths, yielded buffers are
   * chunkSize-sliced pieces of the decrypted/decompressed result and may not
   * correspond 1:1 to the original chunks. `framed` yields authenticated
   * plaintext frames (or downstream gunzip output) instead.
   *
   * @yields {Uint8Array}
   * @throws {CasError} MISSING_KEY if manifest is encrypted but no key is provided.
   * @throws {CasError} INTEGRITY_ERROR if chunk verification or decryption fails.
   */
  async *restoreStream({ manifest, encryptionKey, passphrase }) {
    const encryptionMeta = this._validatedEncryptionMeta(manifest);
    const key = await this._resolveRestoreKey(manifest, encryptionKey, passphrase);

    if (manifest.chunks.length === 0 && !encryptionMeta && !manifest.compression) {
      this.observability.metric('file', {
        action: 'restored', slug: manifest.slug, size: 0, chunkCount: 0,
      });
      return;
    }

    yield* this._dispatchRestore(manifest, key, encryptionMeta);
  }

  /**
   * Routes to the correct restore strategy based on encryption metadata.
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @param {Uint8Array|undefined} key
   * @param {undefined|object} encryptionMeta
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *_dispatchRestore(manifest, key, encryptionMeta) {
    const scheme = encryptionMeta?.scheme;
    const strategy = this._classifyRestoreStrategy(scheme, manifest);
    yield* this._executeRestoreStrategy(strategy, { manifest, key, encryptionMeta });
  }

  /**
   * Classifies which restore strategy to use based on scheme and compression.
   * @private
   * @param {string|undefined} scheme
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @returns {'convergent'|'convergent-compressed'|'framed-compressed'|'framed'|'buffered'|'compressed-streaming'|'streaming'}
   */
  _classifyRestoreStrategy(scheme, manifest) {
    if (scheme === SCHEME_CONVERGENT) {
      return manifest.compression ? 'convergent-compressed' : 'convergent';
    }
    if (scheme === SCHEME_FRAMED) {
      return manifest.compression ? 'framed-compressed' : 'framed';
    }
    if (scheme === SCHEME_WHOLE) { return 'buffered'; }
    if (manifest.compression) { return 'compressed-streaming'; }
    return 'streaming';
  }

  /**
   * Executes the classified restore strategy.
   * @private
   * @param {string} strategy
   * @param {{ manifest: import('../value-objects/Manifest.js').default, key?: Uint8Array, encryptionMeta?: Object }} ctx
   */
  async *_executeRestoreStrategy(strategy, { manifest, key, encryptionMeta }) {
    switch (strategy) {
      case 'convergent': yield* this._restoreConvergentStreaming(manifest, key); break;
      case 'convergent-compressed': yield* this._restoreConvergentCompressed(manifest, key); break;
      case 'framed-compressed': yield* this._restoreFramedCompressedStreaming(manifest, key, encryptionMeta); break;
      case 'framed': yield* this._restoreFramedStreaming(manifest, key, encryptionMeta); break;
      case 'buffered': yield* this._restoreBuffered(manifest, key, encryptionMeta); break;
      case 'compressed-streaming': yield* this._restoreCompressedStreaming(manifest); break;
      default: yield* this._restoreStreaming(manifest); break;
    }
  }

  /**
   * Returns whether file publication must stay on the bounded temp-file path.
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @param {undefined|import('../value-objects/Manifest.js').EncryptionMeta} encryptionMeta
   * @returns {boolean}
   */
  _shouldUseBufferedFileRestore(manifest, encryptionMeta) {
    // Convergent decrypts per-chunk — no buffering needed
    if (encryptionMeta?.scheme === SCHEME_CONVERGENT) {
      return false;
    }
    return encryptionMeta?.scheme === SCHEME_WHOLE;
  }

  /**
   * Builds the restore source used by bounded temp-file publication.
   * @private
   * @param {Object} options
   * @param {import('../value-objects/Manifest.js').default} options.manifest
   * @param {Uint8Array} [options.encryptionKey]
   * @param {string} [options.passphrase]
   * @param {undefined|import('../value-objects/Manifest.js').EncryptionMeta} options.encryptionMeta
   * @returns {Promise<AsyncIterable<Uint8Array>>}
   */
  async _createBufferedFileRestoreSource({ manifest, encryptionKey, passphrase, encryptionMeta }) {
    /** @type {AsyncIterable<Uint8Array>} */
    let source = this._iterVerifiedChunkBlobs(manifest);

    if (encryptionMeta) {
      const key = await this._resolveRestoreKey(manifest, encryptionKey, passphrase);
      const aad = this._isLegacyNoAad(manifest)
        ? undefined
        : buildWholeAad(manifest.slug);

      if (encryptionMeta.scheme === SCHEME_WHOLE) {
        // whole scheme authentication boundary: buffer entire ciphertext before decryption
        const chunks = [];
        for await (const chunk of source) {
          chunks.push(chunk);
        }
        const ciphertext = concatBytes(chunks);
        const plaintext = await this._decryptWithAad({
          buffer: ciphertext,
          key,
          meta: encryptionMeta,
          aad,
        });
        source = (async function* plaintextSource() { yield plaintext; })();
      } else {
        source = this.crypto.createDecryptionStream(key, encryptionMeta, aad).decrypt(source);
      }
    }

    if (manifest.compression) {
      source = this._decompressStreaming(source);
    }

    return source;
  }

  /**
   * Buffered restore path for encrypted/compressed manifests.
   * @private
   */
  async *_restoreBuffered(manifest, key, encryptionMeta = this._validatedEncryptionMeta(manifest)) {
    const totalSize = manifest.chunks.reduce((acc, c) => acc + c.size, 0);
    if (totalSize > this.maxRestoreBufferSize) {
      throw new CasError(
        `Encrypted/compressed restore would buffer ${totalSize} bytes ` +
        `(limit: ${this.maxRestoreBufferSize}). Increase maxRestoreBufferSize ` +
        'or store without encryption.',
        'RESTORE_TOO_LARGE',
        { size: totalSize, limit: this.maxRestoreBufferSize },
      );
    }
    let buffer = concatBytes(await this._readAndVerifyChunks(manifest.chunks, {
      totalLimit: this.maxRestoreBufferSize,
    }));

    if (encryptionMeta) {
      try {
        const aad = this._isLegacyNoAad(manifest)
          ? undefined
          : buildWholeAad(manifest.slug);
        buffer = await this._decryptWithAad({ buffer, key, meta: encryptionMeta, aad });
      } catch (err) {
        if (err instanceof CasError && err.code === 'INTEGRITY_ERROR') {
          this.observability.metric('error', { action: 'decryption_failed', slug: manifest.slug });
        }
        throw err;
      }
    }

    if (manifest.compression) {
      buffer = await this._decompressBufferedWithLimit(buffer, this.maxRestoreBufferSize);
    }

    this.observability.metric('file', {
      action: 'restored', slug: manifest.slug, size: buffer.length, chunkCount: manifest.chunks.length,
    });

    for (let offset = 0; offset < buffer.length; offset += this.chunkSize) {
      yield buffer.subarray(offset, offset + this.chunkSize);
    }
  }

  /**
   * Per-chunk streaming restore with read-ahead.
   * @private
   */
  async *_restoreStreaming(manifest) {
    const chunks = manifest.chunks;
    const readAhead = this.concurrency;
    let totalSize = 0;

    const readAndVerify = (chunk) => this._readAndVerifyChunk(chunk);

    const ahead = [];
    for (let i = 0; i < Math.min(readAhead, chunks.length); i++) {
      ahead.push(readAndVerify(chunks[i]));
    }

    try {
      for (let i = 0; i < chunks.length; i++) {
        const blob = await ahead[i % readAhead];
        this.observability.metric('chunk', { action: 'restored', index: chunks[i].index, size: blob.length, digest: chunks[i].digest });
        totalSize += blob.length;
        const nextIdx = i + readAhead;
        if (nextIdx < chunks.length) {
          ahead[i % readAhead] = readAndVerify(chunks[nextIdx]);
        }
        yield blob;
      }
    } finally {
      await Promise.allSettled(ahead);
    }

    this.observability.metric('file', {
      action: 'restored', slug: manifest.slug, size: totalSize, chunkCount: chunks.length,
    });
  }

  /**
   * Streaming restore path for plaintext + compressed content.
   * Decompresses chunk data on the fly without buffering the entire payload.
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *_restoreCompressedStreaming(manifest) {
    let totalSize = 0;
    for await (const chunk of this._decompressStreaming(this._iterVerifiedChunkBlobs(manifest))) {
      totalSize += chunk.length;
      yield chunk;
    }

    this.observability.metric('file', {
      action: 'restored', slug: manifest.slug, size: totalSize, chunkCount: manifest.chunks.length,
    });
  }

  /**
   * Reads and decrypts convergent-encrypted chunks, prefetching when concurrency > 1.
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @param {Uint8Array} key - Convergent master key.
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *_iterConvergentChunks(manifest, key) {
    const fetchFn = async (chunk) => {
      const plaintext = await this._readAndVerifyChunk(chunk, { convergentKey: key });
      this.observability.metric('chunk', { action: 'restored', index: chunk.index, size: plaintext.length, digest: chunk.digest });
      return plaintext;
    };

    if (this.concurrency > 1) {
      yield* prefetchChunks(manifest.chunks, fetchFn, this.concurrency);
    } else {
      for (const chunk of manifest.chunks) {
        yield await fetchFn(chunk);
      }
    }
  }

  async *_restoreConvergentStreaming(manifest, key) {
    let totalSize = 0;
    for await (const plaintext of this._iterConvergentChunks(manifest, key)) {
      totalSize += plaintext.length;
      yield plaintext;
    }

    this.observability.metric('file', {
      action: 'restored', slug: manifest.slug, size: totalSize, chunkCount: manifest.chunks.length,
    });
  }

  /**
   * Streaming restore path for convergent encrypted + compressed content.
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @param {Uint8Array} key - Convergent master key.
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *_restoreConvergentCompressed(manifest, key) {
    const decryptedSource = this._iterConvergentChunks(manifest, key);

    let totalSize = 0;
    for await (const chunk of this._decompressStreaming(decryptedSource)) {
      totalSize += chunk.length;
      yield chunk;
    }

    this.observability.metric('file', {
      action: 'restored', slug: manifest.slug, size: totalSize, chunkCount: manifest.chunks.length,
    });
  }

  /**
   * Reads and verifies stored chunk blobs, prefetching when concurrency > 1.
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *_iterVerifiedChunkBlobs(manifest) {
    const fetchFn = async (chunk) => {
      const blob = await this._readAndVerifyChunk(chunk);
      this.observability.metric('chunk', { action: 'restored', index: chunk.index, size: blob.length, digest: chunk.digest });
      return blob;
    };

    if (this.concurrency > 1) {
      yield* prefetchChunks(manifest.chunks, fetchFn, this.concurrency);
    } else {
      for (const chunk of manifest.chunks) {
        yield await fetchFn(chunk);
      }
    }
  }

  /**
   * Parses framed records from a byte stream.
   * @private
   * @param {AsyncIterable<Uint8Array>} source
   * @param {number} frameBytes
   * @returns {AsyncIterable<{ ciphertext: Uint8Array, meta: { encrypted: true, algorithm: 'aes-256-gcm', nonce: string, tag: string } }>}
   */
  async *_parseFramedRecords(source, frameBytes) {
    let pending = new Uint8Array(0);

    for await (const chunk of source) {
      const buf = normalizeByteChunk(chunk);
      pending = pending.length === 0 ? buf : concatBytes([pending, buf]);

      while (pending.length >= FRAMED_RECORD_HEADER_BYTES) {
        const consumed = this._consumeFramedRecord(pending, frameBytes);
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
   * Tries to consume one framed record from a pending buffer.
   * @private
   * @param {Uint8Array} pending
   * @param {number} frameBytes
   * @returns {null|{ remaining: Uint8Array, record: { ciphertext: Uint8Array, meta: { encrypted: true, algorithm: 'aes-256-gcm', nonce: string, tag: string } } }}
   */
  _consumeFramedRecord(pending, frameBytes) {
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
        meta: this._buildFramedRecordMeta(pending),
      },
    };
  }

  /**
   * Builds decryption metadata from a framed record header.
   * @private
   * @param {Uint8Array} pending
   * @returns {{ encrypted: true, algorithm: 'aes-256-gcm', nonce: string, tag: string }}
   */
  _buildFramedRecordMeta(pending) {
    return {
      encrypted: true,
      algorithm: 'aes-256-gcm',
      nonce: encodeBase64(pending.subarray(FRAMED_LENGTH_BYTES, FRAMED_LENGTH_BYTES + GCM_NONCE_BYTES)),
      tag: encodeBase64(pending.subarray(FRAMED_LENGTH_BYTES + GCM_NONCE_BYTES, FRAMED_RECORD_HEADER_BYTES)),
    };
  }

  /**
   * Decrypts framed records into authenticated plaintext frames.
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @param {Uint8Array} key
   * @param {{ encrypted: true, algorithm: 'aes-256-gcm', frameBytes: number }} encryptionMeta
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *_decryptFramedSource(manifest, key, encryptionMeta) {
    const noAad = this._isLegacyNoAad(manifest);
    let frameIndex = 0;
    for await (const record of this._parseFramedRecords(
      this._iterVerifiedChunkBlobs(manifest),
      encryptionMeta.frameBytes,
    )) {
      let plaintext;
      try {
        const aad = noAad
          ? undefined
          : buildFramedAad(manifest.slug, frameIndex);
        plaintext = await this._decryptWithAad({
          buffer: record.ciphertext,
          key,
          meta: record.meta,
          aad,
        });
      } catch (err) {
        if (err instanceof CasError && err.code === 'INTEGRITY_ERROR') {
          this.observability.metric('error', { action: 'decryption_failed', slug: manifest.slug });
        }
        throw err;
      }

      frameIndex++;
      if (plaintext.length > 0) {
        yield plaintext;
      }
    }
  }

  /**
   * Streaming restore path for framed encrypted content.
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @param {Uint8Array} key
   * @param {{ encrypted: true, algorithm: 'aes-256-gcm', frameBytes: number }} encryptionMeta
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *_restoreFramedStreaming(manifest, key, encryptionMeta) {
    let totalSize = 0;
    for await (const chunk of this._decryptFramedSource(manifest, key, encryptionMeta)) {
      totalSize += chunk.length;
      yield chunk;
    }

    this.observability.metric('file', {
      action: 'restored',
      slug: manifest.slug,
      size: totalSize,
      chunkCount: manifest.chunks.length,
    });
  }

  /**
   * Streaming restore path for framed encrypted + compressed content.
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @param {Uint8Array} key
   * @param {{ encrypted: true, algorithm: 'aes-256-gcm', frameBytes: number }} encryptionMeta
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *_restoreFramedCompressedStreaming(manifest, key, encryptionMeta) {
    let totalSize = 0;
    for await (const chunk of this._decompressStreaming(this._decryptFramedSource(manifest, key, encryptionMeta))) {
      totalSize += chunk.length;
      yield chunk;
    }

    this.observability.metric('file', {
      action: 'restored',
      slug: manifest.slug,
      size: totalSize,
      chunkCount: manifest.chunks.length,
    });
  }

  /**
   * Decompresses a gzip buffer while enforcing an output-size limit during
   * collection rather than after full materialization.
   * @private
   * @param {Uint8Array} buffer
   * @param {number} limit
   * @returns {Promise<Uint8Array>}
   */
  async _decompressBufferedWithLimit(buffer, limit) {
    const chunks = [];
    let total = 0;

    async function* source() {
      yield buffer;
    }

    for await (const chunk of this._decompressStreaming(source())) {
      total += chunk.length;
      if (total > limit) {
        throw new CasError(
          `Decompressed restore is ${total} bytes (limit: ${limit})`,
          'RESTORE_TOO_LARGE',
          { size: total, limit },
        );
      }
      chunks.push(chunk);
    }

    return concatBytes(chunks);
  }

  /**
   * Decompresses a gzip byte stream.
   * @private
   * @param {AsyncIterable<Uint8Array>} source
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *_decompressStreaming(source) {
    try {
      for await (const chunk of this.compressionAdapter.decompressStream(source)) {
        yield chunk;
      }
    } catch (err) {
      if (err instanceof CasError) { throw err; }
      throw new CasError(`Decompression failed: ${err.message}`, 'INTEGRITY_ERROR', { originalError: err });
    }
  }

  /**
   * Reads a manifest from a Git tree OID.
   *
   * @param {Object} options
   * @param {string} options.treeOid - Git tree OID to read the manifest from
   * @returns {Promise<import('../value-objects/Manifest.js').default>}
   * @throws {CasError} MANIFEST_NOT_FOUND if no manifest entry exists in the tree
   * @throws {CasError} GIT_ERROR if the underlying Git command fails
   */
  async readManifest({ treeOid }) {
    const blob = await this._readManifestBlob(treeOid);
    const decoded = this.codec.decode(blob);

    await this._verifyManifestHash(decoded, treeOid);

    const originalScheme = this._resolveEncryptionScheme(decoded);

    if (decoded.version === 2 && decoded.subManifests?.length > 0) {
      decoded.chunks = await this._resolveSubManifests(decoded.subManifests, treeOid);
    }

    const manifest = new Manifest(decoded);
    // For schemeless manifests, store undefined so _isLegacyNoAad treats
    // them like whole-v1 (no AAD). For normal legacy schemes, store the
    // original scheme string.
    if (this.#legacyMode && decoded.encryption) {
      originalSchemeMap.set(manifest, originalScheme);
    }
    return manifest;
  }

  /**
   * Resolves and normalises the encryption scheme on a decoded manifest.
   *
   * In legacy mode, schemeless manifests get `SCHEME_WHOLE` and versioned
   * scheme identifiers are mapped to their current names.  In normal mode
   * the scheme is asserted to be current.
   *
   * @private
   * @param {Object} decoded - Mutable decoded manifest data.
   * @returns {string|undefined} The original scheme string before mapping
   *   (used for AAD decisions), or undefined for schemeless manifests.
   */
  _resolveEncryptionScheme(decoded) {
    // Schemeless legacy manifests: encrypted but no scheme field.
    // These were always whole-object encryption (pre-scheme era).
    if (this.#legacyMode && decoded.encryption && !decoded.encryption.scheme) {
      decoded.encryption.scheme = SCHEME_WHOLE;
      return undefined;
    }

    if (!decoded.encryption?.scheme) { return undefined; }

    const originalScheme = decoded.encryption.scheme;
    if (this.#legacyMode) {
      const mapped = mapToCurrentScheme(originalScheme);
      if (mapped) { decoded.encryption.scheme = mapped; }
    } else {
      assertCurrentScheme(decoded.encryption.scheme);
    }
    return originalScheme;
  }

  /**
   * Reads a manifest from a Git tree OID and returns the raw decoded
   * object WITHOUT Manifest construction or scheme assertion.
   *
   * This is the migration entry point -- it can read manifests with
   * legacy encryption scheme identifiers that the normal
   * {@link readManifest} rejects.
   *
   * @param {Object} options
   * @param {string} options.treeOid - Git tree OID.
   * @returns {Promise<Object>} Raw decoded manifest data.
   */
  async readManifestRaw({ treeOid }) {
    const blob = await this._readManifestBlob(treeOid);
    return this.codec.decode(blob);
  }

  /**
   * Reads the raw manifest blob from a Git tree.
   * @private
   * @param {string} treeOid
   * @returns {Promise<Uint8Array>}
   */
  async _readManifestBlob(treeOid) {
    let entries;
    try {
      entries = await this.persistence.readTree(treeOid);
    } catch (err) {
      if (err instanceof CasError) { throw err; }
      throw new CasError(
        `Failed to read tree ${treeOid}: ${err.message}`,
        'GIT_ERROR',
        { treeOid, originalError: err },
      );
    }

    const manifestName = `manifest.${this.codec.extension}`;
    const manifestEntry = entries.find((e) => e.name === manifestName);

    if (!manifestEntry) {
      throw new CasError(
        `No manifest entry (${manifestName}) found in tree ${treeOid}`,
        'MANIFEST_NOT_FOUND',
        { treeOid, expectedName: manifestName },
      );
    }

    try {
      return await this.persistence.readBlob(manifestEntry.oid);
    } catch (err) {
      if (err instanceof CasError) { throw err; }
      throw new CasError(
        `Failed to read manifest blob ${manifestEntry.oid}: ${err.message}`,
        'GIT_ERROR',
        { treeOid, manifestOid: manifestEntry.oid, originalError: err },
      );
    }
  }

  /**
   * Verifies the manifest integrity hash if present.
   * @private
   * @param {Object} decoded - Decoded manifest data.
   * @param {string} treeOid - Tree OID (for error context).
   */
  async _verifyManifestHash(decoded, treeOid) {
    if (!decoded.manifestHash) { return; }
    const hashableBytes = encodeForHash(decoded, this.codec);
    const computed = await this.crypto.sha256(hashableBytes);
    if (computed !== decoded.manifestHash) {
      throw new CasError(
        'Manifest integrity check failed: hash mismatch',
        'MANIFEST_INTEGRITY_ERROR',
        { treeOid, slug: decoded.slug, expected: decoded.manifestHash, actual: computed },
      );
    }
  }

  /**
   * Reads and flattens sub-manifest blobs into a single chunk array.
   * @private
   * @param {Array<{ oid: string }>} subManifests - Sub-manifest references.
   * @param {string} treeOid - Parent tree OID (for error context).
   * @returns {Promise<Array>} Flattened chunk entries.
   */
  async _resolveSubManifests(subManifests, treeOid) {
    const allChunks = [];
    for (const ref of subManifests) {
      const subBlob = await this._readSubManifestBlob(ref.oid, treeOid);
      const subDecoded = this.codec.decode(subBlob);
      if (subDecoded.chunks.length !== ref.chunkCount) {
        throw new CasError(
          `Sub-manifest ${ref.oid} declares chunkCount ${ref.chunkCount} but contains ${subDecoded.chunks.length} chunks`,
          'MANIFEST_INTEGRITY_ERROR',
          { subManifestOid: ref.oid, declaredCount: ref.chunkCount, actualCount: subDecoded.chunks.length, treeOid },
        );
      }
      try {
        allChunks.push(...subDecoded.chunks.map((c) => ChunkSchema.parse(c)));
      } catch (err) {
        throw new CasError(
          `Sub-manifest ${ref.oid} contains invalid chunk data: ${err.message}`,
          'MANIFEST_INTEGRITY_ERROR',
          { subManifestOid: ref.oid, treeOid, originalError: err },
        );
      }
    }
    return allChunks;
  }

  /**
   * Reads a sub-manifest blob, wrapping errors as GIT_ERROR.
   * @private
   */
  async _readSubManifestBlob(oid, treeOid) {
    try {
      return await this.persistence.readBlob(oid);
    } catch (err) {
      if (err instanceof CasError) { throw err; }
      throw new CasError(
        `Failed to read sub-manifest blob ${oid}: ${err.message}`,
        'GIT_ERROR',
        { treeOid, subManifestOid: oid, originalError: err },
      );
    }
  }

  /**
   * Compares two manifests by chunk digest to find added, removed, and unchanged chunks.
   *
   * Pure function — no I/O. Works with any pair of Manifest instances.
   *
   * @param {import('../value-objects/Manifest.js').default} oldManifest
   * @param {import('../value-objects/Manifest.js').default} newManifest
   * @returns {import('./ManifestDiff.js').ManifestDiffResult}
   */
  static diffManifests(oldManifest, newManifest) {
    return diffManifests(oldManifest, newManifest);
  }

  /**
   * Reads a manifest from a Git tree and returns inspection metadata.
   * Does not perform any destructive Git operations.
   *
   * @param {Object} options
   * @param {string} options.treeOid - Git tree OID of the asset
   * @returns {Promise<{ chunksOrphaned: number, slug: string }>}
   * @throws {CasError} MANIFEST_NOT_FOUND if the tree has no manifest
   */
  async inspectAsset({ treeOid }) {
    const manifest = await this.readManifest({ treeOid });
    return {
      slug: manifest.slug,
      chunksOrphaned: manifest.chunks.length,
    };
  }

  /**
   * @deprecated Use {@link inspectAsset} instead.
   * @param {Object} options
   * @param {string} options.treeOid - Git tree OID of the asset
   * @returns {Promise<{ chunksOrphaned: number, slug: string }>}
   */
  async deleteAsset(options) {
    this.observability.log('warn', 'deleteAsset() is deprecated — use inspectAsset()');
    return await this.inspectAsset(options);
  }

  /**
   * Aggregates referenced chunk blob OIDs across multiple stored assets.
   * Analysis only — does not delete or modify anything.
   *
   * @param {Object} options
   * @param {string[]} options.treeOids - Git tree OIDs to analyze
   * @returns {Promise<{ referenced: Set<string>, total: number }>}
   * @throws {CasError} MANIFEST_NOT_FOUND if any treeOid lacks a manifest
   */
  async collectReferencedChunks({ treeOids }) {
    const referenced = new Set();
    let total = 0;

    for (const treeOid of treeOids) {
      const manifest = await this.readManifest({ treeOid });
      for (const chunk of manifest.chunks) {
        referenced.add(chunk.blob);
        total += 1;
      }
    }

    return { referenced, total };
  }

  /**
   * @deprecated Use {@link collectReferencedChunks} instead.
   * @param {Object} options
   * @param {string[]} options.treeOids - Git tree OIDs to analyze
   * @returns {Promise<{ referenced: Set<string>, total: number }>}
   */
  async findOrphanedChunks(options) {
    this.observability.log('warn', 'findOrphanedChunks() is deprecated — use collectReferencedChunks()');
    return await this.collectReferencedChunks(options);
  }

  /**
   * Derives an encryption key from a passphrase using PBKDF2 or scrypt.
   * @param {Object} options
   * @param {string} options.passphrase - The passphrase to derive a key from.
   * @param {Uint8Array} [options.salt] - Salt (random if omitted).
   * @param {'pbkdf2'|'scrypt'} [options.algorithm='pbkdf2'] - KDF algorithm.
   * @param {number} [options.iterations] - PBKDF2 iterations.
   * @param {number} [options.cost] - scrypt cost (N).
   * @param {number} [options.blockSize] - scrypt block size (r).
   * @param {number} [options.parallelization] - scrypt parallelization (p).
   * @param {number} [options.keyLength=32] - Derived key length.
   * @returns {Promise<{ key: Uint8Array, salt: Uint8Array, params: Object }>}
   */
  async deriveKey(options) {
    return await this.crypto.deriveKey(options);
  }

  /**
   * Adds a new recipient to an envelope-encrypted manifest.
   *
   * Unwraps the DEK using `existingKey`, wraps it with `newRecipientKey`,
   * and returns a new Manifest with the appended recipient entry.
   *
   * @param {Object} options
   * @param {import('../value-objects/Manifest.js').default} options.manifest
   * @param {Uint8Array} options.existingKey - KEK of an existing recipient.
   * @param {Uint8Array} options.newRecipientKey - KEK for the new recipient.
   * @param {string} options.label - Label for the new recipient.
   * @returns {Promise<import('../value-objects/Manifest.js').default>}
   * @throws {CasError} INVALID_OPTIONS if manifest has no recipients.
   * @throws {CasError} RECIPIENT_ALREADY_EXISTS if label is a duplicate.
   * @throws {CasError} DEK_UNWRAP_FAILED if existingKey doesn't match any recipient.
   */
  async addRecipient({ manifest, existingKey, newRecipientKey, label }) {
    const recipients = manifest.encryption?.recipients;
    if (!recipients || recipients.length === 0) {
      throw new CasError(
        'Manifest does not use envelope encryption (no recipients)',
        'INVALID_OPTIONS',
      );
    }

    if (recipients.some((r) => r.label === label)) {
      throw new CasError(
        `Recipient "${label}" already exists`,
        'RECIPIENT_ALREADY_EXISTS',
        { label },
      );
    }

    this.crypto._validateKey(existingKey);
    this.crypto._validateKey(newRecipientKey);

    // Unwrap DEK using the existing key
    let dek;
    try {
      dek = await this.#keyResolver.resolveKeyForRecipients(manifest, existingKey);
    } catch (err) {
      if (err instanceof CasError && err.code === 'NO_MATCHING_RECIPIENT') {
        throw new CasError('Failed to unwrap DEK: authentication failed', 'DEK_UNWRAP_FAILED', { originalError: err });
      }
      throw err;
    }

    // Wrap DEK for the new recipient
    const newEntry = { label, ...(await this.#keyResolver.wrapDek(dek, newRecipientKey)) };

    const json = manifest.toJSON();
    const updatedEncryption = {
      ...json.encryption,
      recipients: [...recipients.map((r) => ({ ...r })), newEntry],
    };

    return new Manifest({ ...json, encryption: updatedEncryption });
  }

  /**
   * Removes a recipient from an envelope-encrypted manifest.
   *
   * Returns a new Manifest with the recipient entry removed. Does not
   * require a key — this is a manifest-only mutation.
   *
   * @param {Object} options
   * @param {import('../value-objects/Manifest.js').default} options.manifest
   * @param {string} options.label - Label of the recipient to remove.
   * @returns {Promise<import('../value-objects/Manifest.js').default>}
   * @throws {CasError} RECIPIENT_NOT_FOUND if label doesn't exist.
   * @throws {CasError} CANNOT_REMOVE_LAST_RECIPIENT if only one recipient remains.
   */
  async removeRecipient({ manifest, label }) {
    const recipients = manifest.encryption?.recipients;
    if (!recipients || recipients.length === 0) {
      throw new CasError(
        'Manifest does not use envelope encryption (no recipients)',
        'INVALID_OPTIONS',
      );
    }
    if (!recipients.some((r) => r.label === label)) {
      throw new CasError(
        `Recipient "${label}" not found`,
        'RECIPIENT_NOT_FOUND',
        { label },
      );
    }

    if (recipients.length === 1) {
      throw new CasError(
        'Cannot remove the last recipient',
        'CANNOT_REMOVE_LAST_RECIPIENT',
      );
    }

    const filtered = recipients.filter((r) => r.label !== label).map((r) => ({ ...r }));
    if (filtered.length === 0) {
      throw new CasError(
        'Cannot remove the last recipient',
        'CANNOT_REMOVE_LAST_RECIPIENT',
      );
    }
    const json = manifest.toJSON();
    const updatedEncryption = { ...json.encryption, recipients: filtered };

    return new Manifest({ ...json, encryption: updatedEncryption });
  }

  /**
   * Lists recipient labels from an envelope-encrypted manifest.
   *
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @returns {string[]} Recipient labels, or empty array if not envelope-encrypted.
   */
  listRecipients(manifest) {
    return (manifest.encryption?.recipients || []).map((r) => r.label);
  }

  /**
   * Rotates a recipient's key without re-encrypting data blobs.
   *
   * Re-wraps the DEK with `newKey` for the matched recipient entry.
   * Increments `keyVersion` at both manifest-level and recipient-level.
   *
   * @param {Object} options
   * @param {import('../value-objects/Manifest.js').default} options.manifest
   * @param {Uint8Array} options.oldKey - Current KEK of the recipient to rotate.
   * @param {Uint8Array} options.newKey - New KEK to wrap the DEK with.
   * @param {string} [options.label] - If provided, only rotate the named recipient.
   * @returns {Promise<import('../value-objects/Manifest.js').default>}
   * @throws {CasError} ROTATION_NOT_SUPPORTED if manifest has no recipients.
   * @throws {CasError} RECIPIENT_NOT_FOUND if label doesn't exist.
   * @throws {CasError} DEK_UNWRAP_FAILED if oldKey doesn't match the recipient.
   * @throws {CasError} NO_MATCHING_RECIPIENT if no label and oldKey matches no entry.
   */
  async rotateKey({ manifest, oldKey, newKey, label }) {
    const recipients = manifest.encryption?.recipients;
    if (!recipients || recipients.length === 0) {
      throw new CasError(
        'Key rotation requires envelope encryption (recipients)',
        'ROTATION_NOT_SUPPORTED',
      );
    }

    this.crypto._validateKey(oldKey);
    this.crypto._validateKey(newKey);

    const { matchIndex, dek } = label
      ? await this.#findRecipientByLabel(recipients, label, oldKey)
      : await this.#findRecipientByKey(recipients, oldKey);

    return this.#buildRotatedManifest({ manifest, recipients, matchIndex, dek, newKey });
  }

  /**
   * Finds a recipient by label and unwraps the DEK.
   */
  async #findRecipientByLabel(recipients, label, oldKey) {
    const matchIndex = recipients.findIndex((r) => r.label === label);
    if (matchIndex === -1) {
      throw new CasError(`Recipient "${label}" not found`, 'RECIPIENT_NOT_FOUND', { label });
    }
    const dek = await this.#keyResolver.unwrapDek(recipients[matchIndex], oldKey);
    return { matchIndex, dek };
  }

  /**
   * Finds the first recipient whose DEK can be unwrapped with the given key.
   */
  async #findRecipientByKey(recipients, oldKey) {
    for (let i = 0; i < recipients.length; i++) {
      try {
        const dek = await this.#keyResolver.unwrapDek(recipients[i], oldKey);
        return { matchIndex: i, dek };
      } catch (err) {
        if (!(err instanceof CasError && err.code === 'DEK_UNWRAP_FAILED')) { throw err; }
      }
    }
    throw new CasError(
      'No recipient entry could be unwrapped with the provided key',
      'NO_MATCHING_RECIPIENT',
    );
  }

  /**
   * Builds a new Manifest with the rotated recipient entry and updated keyVersions.
   */
  async #buildRotatedManifest({ manifest, recipients, matchIndex, dek, newKey }) {
    const newWrapped = await this.#keyResolver.wrapDek(dek, newKey);
    const manifestKeyVersion = (manifest.encryption.keyVersion || 0) + 1;
    const recipientKeyVersion = (recipients[matchIndex].keyVersion || 0) + 1;

    const json = manifest.toJSON();
    const updatedRecipients = recipients.map((r, i) => {
      if (i === matchIndex) {
        return { ...r, ...newWrapped, keyVersion: recipientKeyVersion };
      }
      return { ...r };
    });

    return new Manifest({
      ...json,
      encryption: { ...json.encryption, recipients: updatedRecipients, keyVersion: manifestKeyVersion },
    });
  }

  /**
   * Verifies the integrity of a stored file by re-hashing its chunks.
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @param {{ encryptionKey?: Uint8Array, passphrase?: string }} [options]
   * @returns {Promise<boolean>}
   */
  async verifyIntegrity(manifest, options = {}) {
    const encryptionMeta = this._getVerifyEncryptionMeta(manifest);
    if (encryptionMeta === false) {
      return false;
    }

    if (encryptionMeta?.scheme === SCHEME_CONVERGENT) {
      return this._verifyConvergentIntegrity(manifest, encryptionMeta, options);
    }

    return this._verifyNonConvergentIntegrity(manifest, encryptionMeta, options);
  }

  /**
   * Verifies integrity for non-convergent schemes (whole, framed, unencrypted).
   * @private
   */
  async _verifyNonConvergentIntegrity(manifest, encryptionMeta, options) {
    const buffers = await this._verifyChunkDigests(manifest);
    if (buffers === false) {
      return false;
    }

    if (encryptionMeta) {
      const key = await this._resolveVerifyKey(manifest, options);
      if (key === false) {
        return false;
      }
      const authOk = encryptionMeta.scheme === SCHEME_FRAMED
        ? await this._verifyFramedAuth({ manifest, encryptionMeta, key, buffers })
        : await this._verifyEncryptedAuth({ manifest, encryptionMeta, key, buffers });
      if (!authOk) {
        return false;
      }
    }

    this.observability.metric('integrity', { action: 'pass', slug: manifest.slug });
    return true;
  }

  /**
   * Verifies integrity of convergent encrypted content by decrypting
   * each chunk and checking plaintext digests.
   * @private
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @param {{ scheme: 'convergent' }} _encryptionMeta
   * @param {{ encryptionKey?: Uint8Array, passphrase?: string }} options
   * @returns {Promise<boolean>}
   */
  async _verifyConvergentIntegrity(manifest, _encryptionMeta, options) {
    const key = await this._resolveVerifyKey(manifest, options);
    if (key === false) {
      return false;
    }

    try {
      for (const chunk of manifest.chunks) {
        await this._readAndVerifyChunk(chunk, { convergentKey: key });
      }
    } catch (err) {
      if (err instanceof CasError && err.code === 'INTEGRITY_ERROR') {
        this._emitIntegrityFail(manifest, err.meta);
        return false;
      }
      throw err;
    }

    this.observability.metric('integrity', { action: 'pass', slug: manifest.slug });
    return true;
  }
}
