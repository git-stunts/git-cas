import Manifest from '../value-objects/Manifest.js';
import { ChunkSchema } from '../schemas/ManifestSchema.js';
import CasError from '../errors/CasError.js';
import createCasError from '../errors/createCasError.js';
import { normalizeCodecBytes, encodeForHash } from '../helpers/codecBytes.js';
import {
  buildFlatManifestTreeEntries,
  buildMerkleTreeEntries,
} from './GitTreeBuilder.js';
import {
  assertCurrentScheme,
  isLegacyNoAad,
  mapToCurrentScheme,
  SCHEME_WHOLE,
} from '../encryption/schemes.js';

const originalSchemeMap = new WeakMap();

/**
 * Manifest serialization, tree publication, and readback boundary.
 */
export default class ManifestRepository {
  #codec;
  #crypto;
  #legacyMode;
  #merkleThreshold;
  #persistence;

  /**
   * @param {Object} options
   * @param {import('../../ports/CodecPort.js').default} options.codec
   * @param {import('../../ports/CryptoPort.js').default} options.crypto
   * @param {boolean} options.legacyMode
   * @param {number} options.merkleThreshold
   * @param {import('../../ports/GitPersistencePort.js').default} options.persistence
   */
  constructor({ codec, crypto, legacyMode, merkleThreshold, persistence }) {
    this.#codec = codec;
    this.#crypto = crypto;
    this.#legacyMode = legacyMode;
    this.#merkleThreshold = merkleThreshold;
    this.#persistence = persistence;
  }

  /**
   * @param {{ manifest: import('../value-objects/Manifest.js').default }} options
   * @returns {Promise<string>}
   */
  async createTree({ manifest }) {
    const chunks = manifest.chunks;
    if (chunks.length > this.#merkleThreshold) {
      return await this.#createMerkleTree({ manifest });
    }

    const manifestData = manifest.toJSON();
    const hashableBytes = encodeForHash(manifestData, this.#codec);
    manifestData.manifestHash = await this.#crypto.sha256(hashableBytes);
    const serializedManifest = normalizeCodecBytes(this.#codec.encode(manifestData));
    const manifestOid = await this.#persistence.writeBlob(serializedManifest);

    const treeEntries = buildFlatManifestTreeEntries({
      manifestOid,
      chunks,
      extension: this.#codec.extension,
    });

    return await this.#persistence.writeTree(treeEntries);
  }

  /**
   * @param {{ treeOid: string }} options
   * @returns {Promise<import('../value-objects/Manifest.js').default>}
   */
  async readManifest({ treeOid }) {
    const blob = await this.#readManifestBlob(treeOid);
    const decoded = this.#codec.decode(blob);

    await this.#verifyManifestHash(decoded, treeOid);
    const originalScheme = this.#resolveEncryptionScheme(decoded);

    if (decoded.version === 2 && decoded.subManifests?.length > 0) {
      decoded.chunks = await this.#resolveSubManifests(decoded.subManifests, treeOid);
    }

    const manifest = new Manifest(decoded);
    if (this.#legacyMode && decoded.encryption) {
      originalSchemeMap.set(manifest, originalScheme);
    }
    return manifest;
  }

  /**
   * @param {{ treeOid: string }} options
   * @returns {Promise<object>}
   */
  async readManifestRaw({ treeOid }) {
    const blob = await this.#readManifestBlob(treeOid);
    return this.#codec.decode(blob);
  }

  /**
   * @param {object} decoded
   * @param {string} treeOid
   */
  async verifyManifestHash(decoded, treeOid) {
    await this.#verifyManifestHash(decoded, treeOid);
  }

  /**
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @returns {boolean}
   */
  isLegacyNoAad(manifest) {
    if (!this.#legacyMode || !originalSchemeMap.has(manifest)) {
      return false;
    }
    const original = originalSchemeMap.get(manifest);
    return original === undefined || isLegacyNoAad(original);
  }

  async #createMerkleTree({ manifest }) {
    const chunks = [...manifest.chunks];
    const subManifestRefs = [];

    for (let i = 0; i < chunks.length; i += this.#merkleThreshold) {
      const group = chunks.slice(i, i + this.#merkleThreshold);
      const subManifestData = { chunks: group.map((c) => ({ index: c.index, size: c.size, digest: c.digest, blob: c.blob })) };
      const serialized = normalizeCodecBytes(this.#codec.encode(subManifestData));
      const oid = await this.#persistence.writeBlob(serialized);

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
    const rootHashableBytes = encodeForHash(rootManifestData, this.#codec);
    rootManifestData.manifestHash = await this.#crypto.sha256(rootHashableBytes);

    const serializedRoot = normalizeCodecBytes(this.#codec.encode(rootManifestData));
    const rootManifestOid = await this.#persistence.writeBlob(serializedRoot);

    const treeEntries = buildMerkleTreeEntries({
      rootManifestOid,
      subManifests: subManifestRefs,
      chunks,
      extension: this.#codec.extension,
    });

    return await this.#persistence.writeTree(treeEntries);
  }

  async #readManifestBlob(treeOid) {
    let entries;
    try {
      entries = await this.#persistence.readTree(treeOid);
    } catch (err) {
      if (err instanceof CasError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw createCasError(
        `Failed to read tree ${treeOid}: ${message}`,
        'GIT_ERROR',
        { treeOid, originalError: err },
      );
    }

    const manifestName = `manifest.${this.#codec.extension}`;
    const manifestEntry = entries.find((entry) => entry.name === manifestName);
    if (!manifestEntry) {
      throw createCasError(
        `No manifest entry (${manifestName}) found in tree ${treeOid}`,
        'MANIFEST_NOT_FOUND',
        { treeOid, expectedName: manifestName },
      );
    }

    try {
      return await this.#persistence.readBlob(manifestEntry.oid);
    } catch (err) {
      if (err instanceof CasError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw createCasError(
        `Failed to read manifest blob ${manifestEntry.oid}: ${message}`,
        'GIT_ERROR',
        { treeOid, manifestOid: manifestEntry.oid, originalError: err },
      );
    }
  }

  async #verifyManifestHash(decoded, treeOid) {
    if (!decoded.manifestHash) {
      return;
    }
    const hashableBytes = encodeForHash(decoded, this.#codec);
    const computed = await this.#crypto.sha256(hashableBytes);
    if (computed !== decoded.manifestHash) {
      throw createCasError(
        'Manifest integrity check failed: hash mismatch',
        'MANIFEST_INTEGRITY_ERROR',
        { treeOid, slug: decoded.slug, expected: decoded.manifestHash, actual: computed },
      );
    }
  }

  #resolveEncryptionScheme(decoded) {
    if (this.#legacyMode && decoded.encryption && !decoded.encryption.scheme) {
      decoded.encryption.scheme = SCHEME_WHOLE;
      return undefined;
    }
    if (!decoded.encryption?.scheme) {
      return undefined;
    }

    const originalScheme = decoded.encryption.scheme;
    if (this.#legacyMode) {
      const mapped = mapToCurrentScheme(originalScheme);
      if (mapped) {
        decoded.encryption.scheme = mapped;
      }
    } else {
      assertCurrentScheme(decoded.encryption.scheme);
    }
    return originalScheme;
  }

  async #resolveSubManifests(subManifests, treeOid) {
    const allChunks = [];
    for (const ref of subManifests) {
      const subBlob = await this.#readSubManifestBlob(ref.oid, treeOid);
      const subDecoded = this.#codec.decode(subBlob);
      if (subDecoded.chunks.length !== ref.chunkCount) {
        throw createCasError(
          `Sub-manifest ${ref.oid} declares chunkCount ${ref.chunkCount} but contains ${subDecoded.chunks.length} chunks`,
          'MANIFEST_INTEGRITY_ERROR',
          { subManifestOid: ref.oid, declaredCount: ref.chunkCount, actualCount: subDecoded.chunks.length, treeOid },
        );
      }
      try {
        allChunks.push(...subDecoded.chunks.map((chunk) => ChunkSchema.parse(chunk)));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw createCasError(
          `Sub-manifest ${ref.oid} contains invalid chunk data: ${message}`,
          'MANIFEST_INTEGRITY_ERROR',
          { subManifestOid: ref.oid, treeOid, originalError: err },
        );
      }
    }
    return allChunks;
  }

  async #readSubManifestBlob(oid, treeOid) {
    try {
      return await this.#persistence.readBlob(oid);
    } catch (err) {
      if (err instanceof CasError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw createCasError(
        `Failed to read sub-manifest blob ${oid}: ${message}`,
        'GIT_ERROR',
        { treeOid, subManifestOid: oid, originalError: err },
      );
    }
  }
}
