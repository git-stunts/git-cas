import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import Oid from './Oid.js';

export const ASSET_HANDLE_VERSION = 1;
export const ASSET_HANDLE_KIND = 'asset';
export const ASSET_HANDLE_FORMAT = 'manifest-tree';

const TOKEN_PREFIX = 'git-cas';
const CODEC_PATTERN = /^[a-z0-9][a-z0-9.-]{0,31}$/u;

/**
 * Immutable, repository-independent locator for a git-cas asset graph.
 */
export default class AssetHandle {
  /**
   * @param {object} value
   * @param {number} [value.version]
   * @param {string} [value.kind]
   * @param {string} [value.format]
   * @param {string} value.codec
   * @param {string} [value.hashAlgorithm]
   * @param {string} value.oid
   */
  constructor(value) {
    AssetHandle.#assertObject(value);
    AssetHandle.#assertEnvelope(value);

    let oid;
    try {
      oid = Oid.from(value.oid).toString();
    } catch (error) {
      throw AssetHandle.#invalid('Asset handle contains an invalid Git object identifier', {
        value,
        originalError: error,
      });
    }
    const hashAlgorithm = oid.length === 40 ? 'sha1' : 'sha256';
    if (value.hashAlgorithm !== undefined && value.hashAlgorithm !== hashAlgorithm) {
      throw AssetHandle.#invalid(
        'Asset handle hash algorithm does not match its object identifier',
        {
          hashAlgorithm: value.hashAlgorithm,
          oid,
        }
      );
    }

    this.version = ASSET_HANDLE_VERSION;
    this.kind = ASSET_HANDLE_KIND;
    this.format = ASSET_HANDLE_FORMAT;
    this.codec = value.codec;
    this.hashAlgorithm = hashAlgorithm;
    this.oid = oid;
    Object.freeze(this);
  }

  /**
   * @param {AssetHandle|string|object} value
   * @returns {AssetHandle}
   */
  static from(value) {
    if (value instanceof AssetHandle) {
      return value;
    }
    if (typeof value === 'string') {
      return AssetHandle.parse(value);
    }
    return new AssetHandle(value);
  }

  /**
   * @param {string} token
   * @returns {AssetHandle}
   */
  static parse(token) {
    if (typeof token !== 'string') {
      throw AssetHandle.#invalid('Asset handle token must be a string', { token });
    }
    const fields = token.split(':');
    if (fields.length !== 7 || fields[0] !== TOKEN_PREFIX) {
      throw AssetHandle.#invalid('Asset handle token has an invalid shape', { token });
    }
    const [, version, kind, format, codec, hashAlgorithm, oid] = fields;
    if (kind !== ASSET_HANDLE_KIND) {
      throw createCasError('Handle kind is not asset', ErrorCodes.HANDLE_KIND_MISMATCH, {
        expectedKind: ASSET_HANDLE_KIND,
        actualKind: kind,
      });
    }
    const handle = new AssetHandle({
      version: Number(version),
      kind,
      format,
      codec,
      hashAlgorithm,
      oid,
    });
    if (handle.toString() !== token) {
      throw AssetHandle.#invalid('Asset handle token is not canonical', { token });
    }
    return handle;
  }

  /**
   * @returns {string}
   */
  toString() {
    return [
      TOKEN_PREFIX,
      this.version,
      this.kind,
      this.format,
      this.codec,
      this.hashAlgorithm,
      this.oid,
    ].join(':');
  }

  /**
   * @returns {object}
   */
  toJSON() {
    return {
      version: this.version,
      kind: this.kind,
      format: this.format,
      codec: this.codec,
      hashAlgorithm: this.hashAlgorithm,
      oid: this.oid,
    };
  }

  static #assertObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw AssetHandle.#invalid('Asset handle must be an object or canonical token', { value });
    }
  }

  static #assertEnvelope(value) {
    if (value.version !== undefined && value.version !== ASSET_HANDLE_VERSION) {
      throw AssetHandle.#invalid(`Unsupported asset handle version: ${value.version}`, { value });
    }
    if (value.kind !== undefined && value.kind !== ASSET_HANDLE_KIND) {
      throw createCasError('Handle kind is not asset', ErrorCodes.HANDLE_KIND_MISMATCH, {
        expectedKind: ASSET_HANDLE_KIND,
        actualKind: value.kind,
      });
    }
    if (value.format !== undefined && value.format !== ASSET_HANDLE_FORMAT) {
      throw AssetHandle.#invalid(`Unsupported asset handle format: ${value.format}`, { value });
    }
    if (typeof value.codec !== 'string' || !CODEC_PATTERN.test(value.codec)) {
      throw AssetHandle.#invalid('Asset handle codec must be a canonical lowercase identifier', {
        codec: value.codec,
      });
    }
  }

  static #invalid(message, meta) {
    return createCasError(message, ErrorCodes.HANDLE_INVALID, meta);
  }
}
