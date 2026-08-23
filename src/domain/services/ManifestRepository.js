import Manifest from '../value-objects/Manifest.js';
import Oid from '../value-objects/Oid.js';
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
import { ErrorCodes } from '../errors/index.js';

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
   * @param {{ manifest: Manifest, merkleThreshold?: number }} options
   * @returns {Promise<string>}
   */
  async createTree({ manifest, merkleThreshold }) {
    const chunks = manifest.chunks;
    const effectiveThreshold = merkleThreshold ?? this.#merkleThreshold;
    if (chunks.length > effectiveThreshold) {
      return await this.#createMerkleTree({ manifest, merkleThreshold: effectiveThreshold });
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
   * Creates an explicitly bounded ordered manifest-tree wave. Flat manifest
   * blobs and Merkle sub-manifests share the first blob phase, Merkle roots
   * share the second, and all complete trees share one final tree phase.
   *
   * @param {Array<{ manifest: Manifest, merkleThreshold?: number }>} requests
   * @returns {Promise<string[]>}
   */
  async createTrees(requests) {
    const plans = await Promise.all(requests.map((request) => this.#planTree(request)));
    const firstBlobs = plans.flatMap((plan) => plan.firstBlobs);
    const firstOids = await this.#writeBlobs(firstBlobs);
    let firstIndex = 0;
    for (const plan of plans) {
      plan.acceptFirstOids(firstOids.slice(firstIndex, firstIndex + plan.firstBlobs.length));
      firstIndex += plan.firstBlobs.length;
    }
    const merklePlans = plans.filter((plan) => plan.kind === 'merkle');
    const rootBytes = await Promise.all(merklePlans.map((plan) => plan.rootBytes()));
    const rootOids = await this.#writeBlobs(rootBytes);
    merklePlans.forEach((plan, index) => plan.acceptRootOid(rootOids[index]));
    return await this.#writeTrees(plans.map((plan) => plan.treeEntries()));
  }

  /**
   * @param {{ treeOid: string }} options
   * @returns {Promise<Manifest>}
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
   * @param {Manifest} manifest
   * @returns {boolean}
   */
  isLegacyNoAad(manifest) {
    if (!this.#legacyMode || !originalSchemeMap.has(manifest)) {
      return false;
    }
    const original = originalSchemeMap.get(manifest);
    return original === undefined || isLegacyNoAad(original);
  }

  async #createMerkleTree({ manifest, merkleThreshold }) {
    const chunks = [...manifest.chunks];
    const subManifestRefs = [];

    for (let i = 0; i < chunks.length; i += merkleThreshold) {
      const group = chunks.slice(i, i + merkleThreshold);
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

  async #planTree({ manifest, merkleThreshold }) {
    const effectiveThreshold = merkleThreshold ?? this.#merkleThreshold;
    if (manifest.chunks.length > effectiveThreshold) {
      return this.#planMerkleTree(manifest, effectiveThreshold);
    }
    const manifestData = manifest.toJSON();
    const hashableBytes = encodeForHash(manifestData, this.#codec);
    manifestData.manifestHash = await this.#crypto.sha256(hashableBytes);
    const serialized = normalizeCodecBytes(this.#codec.encode(manifestData));
    let manifestOid;
    return {
      kind: 'flat',
      firstBlobs: [serialized],
      acceptFirstOids: ([oid]) => { manifestOid = oid; },
      rootBytes: async () => null,
      acceptRootOid: () => {},
      treeEntries: () => buildFlatManifestTreeEntries({
        manifestOid,
        chunks: manifest.chunks,
        extension: this.#codec.extension,
      }),
    };
  }

  #planMerkleTree(manifest, merkleThreshold) {
    const chunks = [...manifest.chunks];
    const groups = [];
    for (let index = 0; index < chunks.length; index += merkleThreshold) {
      groups.push({ index, chunks: chunks.slice(index, index + merkleThreshold) });
    }
    const firstBlobs = groups.map(({ chunks: group }) => normalizeCodecBytes(this.#codec.encode({
      chunks: group.map((chunk) => ({
        index: chunk.index,
        size: chunk.size,
        digest: chunk.digest,
        blob: chunk.blob,
      })),
    })));
    let subManifestRefs;
    let rootManifestOid;
    return {
      kind: 'merkle',
      firstBlobs,
      acceptFirstOids: (oids) => {
        subManifestRefs = groups.map((group, index) => ({
          oid: oids[index],
          chunkCount: group.chunks.length,
          startIndex: group.index,
        }));
      },
      rootBytes: async () => {
        const rootManifestData = {
          ...manifest.toJSON(),
          version: 2,
          chunks: [],
          subManifests: subManifestRefs,
        };
        const hashableBytes = encodeForHash(rootManifestData, this.#codec);
        rootManifestData.manifestHash = await this.#crypto.sha256(hashableBytes);
        return normalizeCodecBytes(this.#codec.encode(rootManifestData));
      },
      acceptRootOid: (oid) => { rootManifestOid = oid; },
      treeEntries: () => buildMerkleTreeEntries({
        rootManifestOid,
        subManifests: subManifestRefs,
        chunks,
        extension: this.#codec.extension,
      }),
    };
  }

  async #writeBlobs(contents) {
    if (contents.length === 0) {
      return [];
    }
    const oids = await this.#persistence.writeBlobs(contents);
    ManifestRepository.#assertCardinality('blob', contents, oids);
    return oids;
  }

  async #writeTrees(trees) {
    if (trees.length === 0) {
      return [];
    }
    const oids = await this.#persistence.writeTrees(trees);
    ManifestRepository.#assertCardinality('tree', trees, oids);
    return oids;
  }

  async #readManifestBlob(treeOid) {
    const normalizedTreeOid = Oid.from(treeOid).toString();
    let entries;
    try {
      entries = await this.#persistence.readTree(normalizedTreeOid);
    } catch (err) {
      if (err instanceof CasError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw createCasError(
        `Failed to read tree ${normalizedTreeOid}: ${message}`,
        ErrorCodes.GIT_ERROR,
        { treeOid: normalizedTreeOid, originalError: err },
      );
    }

    const manifestName = `manifest.${this.#codec.extension}`;
    const manifestEntry = entries.find((entry) => entry.name === manifestName);
    if (!manifestEntry) {
      throw createCasError(
        `No manifest entry (${manifestName}) found in tree ${normalizedTreeOid}`,
        ErrorCodes.MANIFEST_NOT_FOUND,
        { treeOid: normalizedTreeOid, expectedName: manifestName },
      );
    }
    const manifestOid = Oid.from(manifestEntry.oid).toString();

    try {
      return await this.#persistence.readBlob(manifestOid);
    } catch (err) {
      if (err instanceof CasError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw createCasError(
        `Failed to read manifest blob ${manifestOid}: ${message}`,
        ErrorCodes.GIT_ERROR,
        { treeOid: normalizedTreeOid, manifestOid, originalError: err },
      );
    }
  }

  async #verifyManifestHash(decoded, treeOid) {
    const normalizedTreeOid = Oid.from(treeOid).toString();
    if (!decoded.manifestHash) {
      return;
    }
    const hashableBytes = encodeForHash(decoded, this.#codec);
    const computed = await this.#crypto.sha256(hashableBytes);
    if (computed !== decoded.manifestHash) {
      throw createCasError(
        'Manifest integrity check failed: hash mismatch',
        ErrorCodes.MANIFEST_INTEGRITY_ERROR,
        { treeOid: normalizedTreeOid, slug: decoded.slug, expected: decoded.manifestHash, actual: computed },
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
          ErrorCodes.MANIFEST_INTEGRITY_ERROR,
          { subManifestOid: ref.oid, declaredCount: ref.chunkCount, actualCount: subDecoded.chunks.length, treeOid },
        );
      }
      try {
        allChunks.push(...subDecoded.chunks.map((chunk) => ChunkSchema.parse(chunk)));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw createCasError(
          `Sub-manifest ${ref.oid} contains invalid chunk data: ${message}`,
          ErrorCodes.MANIFEST_INTEGRITY_ERROR,
          { subManifestOid: ref.oid, treeOid, originalError: err },
        );
      }
    }
    return allChunks;
  }

  static #assertCardinality(kind, input, output) {
    if (output.length !== input.length) {
      throw createCasError(
        `Persistence returned the wrong number of manifest ${kind} identifiers`,
        ErrorCodes.GIT_ERROR,
        { expected: input.length, actual: output.length },
      );
    }
  }

  async #readSubManifestBlob(oid, treeOid) {
    const subManifestOid = Oid.from(oid).toString();
    const normalizedTreeOid = Oid.from(treeOid).toString();
    try {
      return await this.#persistence.readBlob(subManifestOid);
    } catch (err) {
      if (err instanceof CasError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw createCasError(
        `Failed to read sub-manifest blob ${subManifestOid}: ${message}`,
        ErrorCodes.GIT_ERROR,
        { treeOid: normalizedTreeOid, subManifestOid, originalError: err },
      );
    }
  }
}
