/* @ts-self-types="./CasService.d.ts" */
/**
 * @fileoverview Lean domain facade for Content Addressable Storage operations.
 * @module
 */
import Manifest from '../value-objects/Manifest.js';
import CasError from '../errors/CasError.js';
import createCasError from '../errors/createCasError.js';
import EncryptionMetadata from '../value-objects/EncryptionMetadata.js';
import StoreEncryptionConfig from '../value-objects/StoreEncryptionConfig.js';
import KeyResolver from './KeyResolver.js';
import ConvergentEncryption from './ConvergentEncryption.js';
import ChunkRepository from './ChunkRepository.js';
import CompressionStreams from './CompressionStreams.js';
import FramedRecordCodec from '../strategies/FramedRecordCodec.js';
import StorePlain from '../strategies/StorePlain.js';
import StoreConvergent from '../strategies/StoreConvergent.js';
import StoreFramed from '../strategies/StoreFramed.js';
import StoreWhole from '../strategies/StoreWhole.js';
import StoreStrategy from '../strategies/StoreStrategy.js';
import RestorePlain from '../strategies/RestorePlain.js';
import RestoreCompressed from '../strategies/RestoreCompressed.js';
import RestoreConvergent from '../strategies/RestoreConvergent.js';
import RestoreFramed from '../strategies/RestoreFramed.js';
import RestoreWhole from '../strategies/RestoreWhole.js';
import RestoreStrategy from '../strategies/RestoreStrategy.js';
import ManifestRepository from './ManifestRepository.js';
import RecipientService from './RecipientService.js';
import IntegrityVerifier from './IntegrityVerifier.js';
import RestoreSuccess from '../outcomes/RestoreSuccess.js';
import StoreSuccess from '../outcomes/StoreSuccess.js';
import diffManifests from './ManifestDiff.js';
import RedactingObservability from './RedactingObservability.js';

/**
 * Domain service for Content Addressable Storage operations.
 */
export default class CasService {
  #chunkRepository;
  #compression;
  #framed;
  #integrityVerifier;
  #keyResolver;
  #manifestRepository;
  #recipientService;
  #restoreStrategies;
  #storeStrategies;

  /**
   * @param {Object} options
   * @param {import('../../ports/GitPersistencePort.js').default} options.persistence
   * @param {import('../../ports/CodecPort.js').default} options.codec
   * @param {import('../../ports/CryptoPort.js').default} options.crypto
   * @param {import('../../ports/ObservabilityPort.js').default} options.observability
   * @param {number} [options.chunkSize=262144]
   * @param {number} [options.merkleThreshold=1000]
   * @param {number} [options.concurrency=1]
   * @param {import('../../ports/ChunkingPort.js').default} options.chunker
   * @param {number} [options.maxRestoreBufferSize=536870912]
   * @param {import('../../ports/CompressionPort.js').default} options.compressionAdapter
   * @param {string} [options.formatVersion]
   * @param {boolean} [options.legacyMode=false]
   */
  constructor({ persistence, codec, crypto, observability, chunkSize = 256 * 1024, merkleThreshold = 1000, concurrency = 1, chunker, maxRestoreBufferSize = 512 * 1024 * 1024, compressionAdapter, formatVersion, legacyMode = false }) {
    CasService._validateObservability(observability);
    CasService.#validateConstructorArgs({ chunkSize, merkleThreshold, concurrency, maxRestoreBufferSize, chunker, compressionAdapter });
    const safeObservability = RedactingObservability.wrap(observability);

    this.persistence = persistence;
    this.codec = codec;
    this.crypto = crypto;
    this.observability = safeObservability;
    this.chunkSize = chunkSize;
    this.chunker = chunker;
    this.compressionAdapter = compressionAdapter;
    this.formatVersion = formatVersion;
    this.merkleThreshold = merkleThreshold;
    this.concurrency = concurrency;
    this.maxRestoreBufferSize = maxRestoreBufferSize;

    if (chunkSize > 10 * 1024 * 1024) {
      safeObservability.log('warn', `Chunk size ${chunkSize} exceeds 10 MiB — consider a smaller value`, { chunkSize });
    }

    this.#keyResolver = new KeyResolver(crypto);
    const convergent = new ConvergentEncryption(crypto);
    this.#compression = new CompressionStreams(compressionAdapter);
    this.#chunkRepository = new ChunkRepository({
      chunker,
      concurrency,
      convergent,
      hashBytes: (buf) => this._sha256(buf),
      observability: safeObservability,
      persistence,
    });
    this.#framed = new FramedRecordCodec({ crypto, observability: safeObservability });
    this.#manifestRepository = new ManifestRepository({ codec, crypto, legacyMode, merkleThreshold, persistence });
    this.#storeStrategies = this.#buildStoreStrategies({ crypto });
    this.#restoreStrategies = this.#buildRestoreStrategies({ crypto, maxRestoreBufferSize });
    this.#recipientService = new RecipientService({ crypto, keyResolver: this.#keyResolver });
    this.#integrityVerifier = new IntegrityVerifier({
      chunks: this.#chunkRepository,
      crypto,
      framed: this.#framed,
      isLegacyNoAad: (manifest) => this._isLegacyNoAad(manifest),
      keyResolver: this.#keyResolver,
      observability: safeObservability,
      validateEncryptionMeta: (manifest) => this._validatedEncryptionMeta(manifest),
    });
  }

  static #assertIntRange({ value, min, max, label }) {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw createCasError(`${label} must be an integer in [${min}, ${max}]`, 'INVALID_OPTIONS', { label, value, min, max });
    }
  }

  static #validateConstructorArgs({ chunkSize, merkleThreshold, concurrency, maxRestoreBufferSize, chunker, compressionAdapter }) {
    CasService.#assertIntRange({ value: chunkSize, min: 1024, max: 100 * 1024 * 1024, label: 'chunkSize' });
    CasService.#assertIntRange({ value: merkleThreshold, min: 1, max: Number.MAX_SAFE_INTEGER, label: 'merkleThreshold' });
    CasService.#assertIntRange({ value: concurrency, min: 1, max: 64, label: 'concurrency' });
    CasService.#assertIntRange({ value: maxRestoreBufferSize, min: 1024, max: Number.MAX_SAFE_INTEGER, label: 'maxRestoreBufferSize' });
    if (!chunker) {
      throw createCasError('chunker is required — inject a ChunkingPort instance', 'INVALID_OPTIONS');
    }
    if (!compressionAdapter) {
      throw createCasError('compressionAdapter is required — inject a CompressionPort instance', 'INVALID_OPTIONS');
    }
  }

  static _validateObservability(observability) {
    if (!observability || typeof observability.metric !== 'function' || typeof observability.log !== 'function' || typeof observability.span !== 'function') {
      throw createCasError('observability must implement ObservabilityPort', 'INVALID_OPTIONS');
    }
  }

  #buildStoreStrategies({ crypto }) {
    return Object.freeze({
      plain: new StorePlain(this.#chunkRepository),
      convergent: new StoreConvergent(this.#chunkRepository),
      framed: new StoreFramed({ chunks: this.#chunkRepository, framed: this.#framed }),
      whole: new StoreWhole({ chunks: this.#chunkRepository, crypto }),
    });
  }

  #buildRestoreStrategies({ crypto, maxRestoreBufferSize }) {
    return Object.freeze({
      plain: new RestorePlain({ chunks: this.#chunkRepository, observability: this.observability }),
      compressed: new RestoreCompressed({ chunks: this.#chunkRepository, compression: this.#compression, observability: this.observability }),
      convergent: new RestoreConvergent({ chunks: this.#chunkRepository, compression: this.#compression, observability: this.observability }),
      framed: new RestoreFramed({
        chunks: this.#chunkRepository,
        compression: this.#compression,
        framed: this.#framed,
        isLegacyNoAad: (manifest) => this._isLegacyNoAad(manifest),
        observability: this.observability,
      }),
      whole: new RestoreWhole({
        chunkSize: this.chunkSize,
        chunks: this.#chunkRepository,
        compression: this.#compression,
        crypto,
        isLegacyNoAad: (manifest) => this._isLegacyNoAad(manifest),
        maxRestoreBufferSize,
        observability: this.observability,
      }),
    });
  }

  async _sha256(buf) {
    return await this.crypto.sha256(buf);
  }

  async encrypt({ buffer, key }) {
    return await this.crypto.encryptBuffer(buffer, key);
  }

  async decrypt({ buffer, key, meta }) {
    if (!meta?.encrypted) {
      return buffer;
    }
    return await this._decryptWithAad({ buffer, key, meta });
  }

  async _decryptWithAad({ buffer, key, meta, aad }) {
    if (!meta?.encrypted) {
      return buffer;
    }
    try {
      return await this.crypto.decryptBuffer(buffer, key, meta, aad);
    } catch (err) {
      if (err instanceof CasError) {
        throw err;
      }
      throw createCasError('Decryption failed: Integrity check error', 'INTEGRITY_ERROR', { originalError: err });
    }
  }

  _resolveStoreEncryptionConfig(encryption, hasEncryptionKey) {
    return StoreEncryptionConfig.resolve({
      encryption,
      hasEncryptionKey,
      chunker: this.chunker,
      observability: this.observability,
    });
  }

  _resolveFramedStoreEncryptionConfig(frameBytes) {
    return StoreEncryptionConfig.resolveFramed(frameBytes);
  }

  _validatedEncryptionMeta(manifest) {
    return EncryptionMetadata.fromManifest(manifest);
  }

  _emitIntegrityFail(manifest, extra = {}) {
    this.observability.metric('integrity', { action: 'fail', slug: manifest.slug, ...extra });
  }

  _validateCompression(compression) {
    if (compression?.algorithm && compression.algorithm !== 'gzip') {
      throw createCasError(`Unsupported compression algorithm: ${compression.algorithm}`, 'INVALID_OPTIONS');
    }
  }

  _validateChunking(chunking) {
    if (!chunking) {
      return;
    }
    if (!['fixed', 'cdc'].includes(chunking.strategy)) {
      throw createCasError(
        `Unsupported chunking strategy: ${chunking.strategy}`,
        'INVALID_CHUNKING_STRATEGY',
        { strategy: chunking.strategy },
      );
    }
  }

  /**
   * @param {Object} options
   * @param {AsyncIterable<Uint8Array>} options.source
   * @param {string} options.slug
   * @param {string} options.filename
   * @param {Uint8Array} [options.encryptionKey]
   * @param {string} [options.passphrase]
   * @param {{ scheme?: 'whole'|'framed'|'convergent', frameBytes?: number, convergent?: boolean }} [options.encryption]
   * @param {Object} [options.kdfOptions]
   * @param {{ algorithm: 'gzip' }} [options.compression]
   * @param {Array<{label: string, key: Uint8Array}>} [options.recipients]
   * @returns {Promise<import('../value-objects/Manifest.js').default>}
   */
  async store({ source, slug, filename, encryptionKey, passphrase, encryption, kdfOptions, compression, recipients }) {
    if (!source || typeof source[Symbol.asyncIterator] !== 'function') {
      throw createCasError('source must be an async iterable', 'INVALID_OPTIONS', { sourceType: typeof source });
    }
    if (recipients && (encryptionKey || passphrase)) {
      throw createCasError('Provide recipients or encryptionKey/passphrase, not both', 'INVALID_OPTIONS');
    }
    KeyResolver.validateKeySourceExclusive(encryptionKey, passphrase);
    this._validateCompression(compression);

    const keyInfo = recipients
      ? await this.#keyResolver.resolveRecipients(recipients)
      : await this.#keyResolver.resolveForStore(encryptionKey, passphrase, kdfOptions);
    const encryptionConfig = this._resolveStoreEncryptionConfig(encryption, !!keyInfo.key);
    const manifestData = this._buildManifestData(slug, filename, compression);
    const processedSource = compression ? this.#compression.compress(source) : source;

    await this._dispatchStore({ processedSource, manifestData, keyInfo, encryptionConfig });
    const manifest = new Manifest(manifestData);
    this.observability.metric('file', {
      action: 'stored',
      slug,
      size: manifest.size,
      chunkCount: manifest.chunks.length,
      encrypted: !!keyInfo.key,
    });
    return new StoreSuccess({ manifest }).manifest;
  }

  async _dispatchStore({ processedSource, manifestData, keyInfo, encryptionConfig }) {
    const strategy = StoreStrategy.for({
      keyInfo,
      encryptionConfig,
      chunker: this.chunker,
      observability: this.observability,
      strategies: this.#storeStrategies,
    });
    await strategy.execute({ processedSource, manifestData, keyInfo, encryptionConfig });
  }

  _buildManifestData(slug, filename, compression) {
    const data = { slug, filename, size: 0, chunks: [] };
    if (this.formatVersion) {
      data.formatVersion = this.formatVersion;
    }
    if (this.chunker.strategy !== 'fixed') {
      data.chunking = { strategy: this.chunker.strategy, params: this.chunker.params };
    }
    if (compression) {
      data.compression = { algorithm: 'gzip' };
    }
    return data;
  }

  _isLegacyNoAad(manifest) {
    return this.#manifestRepository.isLegacyNoAad(manifest);
  }

  async createTree({ manifest }) {
    return await this.#manifestRepository.createTree({ manifest });
  }

  async restore({ manifest, encryptionKey, passphrase }) {
    const chunks = [];
    for await (const chunk of this.restoreStream({ manifest, encryptionKey, passphrase })) {
      chunks.push(chunk);
    }
    return RestoreSuccess.fromChunks(chunks);
  }

  async createFileRestorePlan({ manifest, encryptionKey, passphrase }) {
    const encryptionMeta = this._validatedEncryptionMeta(manifest);
    if (encryptionMeta?.scheme === 'whole') {
      const key = await this.#keyResolver.resolveForDecryption(manifest, encryptionKey, passphrase);
      return {
        mode: 'bounded-file',
        source: await this.#restoreStrategies.whole.createBoundedSource({ manifest, key, encryptionMeta }),
        encryptionMeta,
      };
    }
    return {
      mode: 'stream',
      source: this.restoreStream({ manifest, encryptionKey, passphrase }),
      encryptionMeta,
    };
  }

  async *restoreStream({ manifest, encryptionKey, passphrase }) {
    const encryptionMeta = this._validatedEncryptionMeta(manifest);
    const key = await this.#keyResolver.resolveForDecryption(manifest, encryptionKey, passphrase);

    if (manifest.chunks.length === 0 && !encryptionMeta && !manifest.compression) {
      this.observability.metric('file', { action: 'restored', slug: manifest.slug, size: 0, chunkCount: 0 });
      return;
    }

    yield* this._dispatchRestore(manifest, key, encryptionMeta);
  }

  async *_dispatchRestore(manifest, key, encryptionMeta) {
    const strategy = RestoreStrategy.for({ manifest, encryptionMeta, strategies: this.#restoreStrategies });
    yield* strategy.execute({ manifest, key, encryptionMeta });
  }

  async readManifest({ treeOid }) {
    return await this.#manifestRepository.readManifest({ treeOid });
  }

  async readManifestRaw({ treeOid }) {
    return await this.#manifestRepository.readManifestRaw({ treeOid });
  }

  async _verifyManifestHash(decoded, treeOid) {
    await this.#manifestRepository.verifyManifestHash(decoded, treeOid);
  }

  static diffManifests(oldManifest, newManifest) {
    return diffManifests(oldManifest, newManifest);
  }

  async inspectAsset({ treeOid }) {
    const manifest = await this.readManifest({ treeOid });
    return { slug: manifest.slug, chunksOrphaned: manifest.chunks.length };
  }

  async deleteAsset(options) {
    this.observability.log('warn', 'deleteAsset() is deprecated — use inspectAsset()');
    return await this.inspectAsset(options);
  }

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

  async findOrphanedChunks(options) {
    this.observability.log('warn', 'findOrphanedChunks() is deprecated — use collectReferencedChunks()');
    return await this.collectReferencedChunks(options);
  }

  async deriveKey(options) {
    return await this.crypto.deriveKey(options);
  }

  async addRecipient(options) {
    return await this.#recipientService.addRecipient(options);
  }

  async removeRecipient(options) {
    return await this.#recipientService.removeRecipient(options);
  }

  listRecipients(manifest) {
    return this.#recipientService.listRecipients(manifest);
  }

  async rotateKey(options) {
    return await this.#recipientService.rotateKey(options);
  }

  async verifyIntegrity(manifest, options = {}) {
    return await this.#integrityVerifier.verify(manifest, options);
  }
}
