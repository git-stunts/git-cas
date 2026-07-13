import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import Oid from './Oid.js';

const TOKEN_PREFIX = 'git-cas';
const CODEC_PATTERN = /^[a-z0-9][a-z0-9.-]{0,31}$/u;

/**
 * Shared immutable envelope for application-facing content handles.
 */
export default class OpaqueHandle {
  /**
   * @param {object} value
   * @param {{ version: number, kind: string, format: string, codec?: string, label: string }} spec
   */
  constructor(value, spec) {
    assertObject(value, spec);
    assertEnvelope(value, spec);

    let oid;
    try {
      oid = Oid.from(value.oid).toString();
    } catch (error) {
      throw invalid(spec, `${spec.label} handle contains an invalid Git object identifier`, {
        value,
        originalError: error,
      });
    }
    const hashAlgorithm = oid.length === 40 ? 'sha1' : 'sha256';
    if (value.hashAlgorithm !== undefined && value.hashAlgorithm !== hashAlgorithm) {
      throw invalid(spec, `${spec.label} handle hash algorithm does not match its object identifier`, {
        hashAlgorithm: value.hashAlgorithm,
        oid,
      });
    }

    this.version = spec.version;
    this.kind = spec.kind;
    this.format = spec.format;
    this.codec = spec.codec ?? value.codec;
    this.hashAlgorithm = hashAlgorithm;
    this.oid = oid;
    Object.freeze(this);
  }

  /**
   * @param {unknown} value
   * @param {new (value: object) => OpaqueHandle} Type
   * @param {object} spec
   * @returns {OpaqueHandle}
   */
  static from(value, Type, spec) {
    if (value instanceof Type) {
      return value;
    }
    if (typeof value === 'string') {
      return OpaqueHandle.parse(value, Type, spec);
    }
    return new Type(value);
  }

  /**
   * @param {unknown} token
   * @param {new (value: object) => OpaqueHandle} Type
   * @param {object} spec
   * @returns {OpaqueHandle}
   */
  static parse(token, Type, spec) {
    if (typeof token !== 'string') {
      throw invalid(spec, `${spec.label} handle token must be a string`, { token });
    }
    const fields = token.split(':');
    if (fields.length !== 7 || fields[0] !== TOKEN_PREFIX) {
      throw invalid(spec, `${spec.label} handle token has an invalid shape`, { token });
    }
    const [, version, kind, format, codec, hashAlgorithm, oid] = fields;
    if (kind !== spec.kind) {
      throw createCasError(`Handle kind is not ${spec.kind}`, ErrorCodes.HANDLE_KIND_MISMATCH, {
        expectedKind: spec.kind,
        actualKind: kind,
      });
    }
    const handle = new Type({
      version: Number(version),
      kind,
      format,
      codec,
      hashAlgorithm,
      oid,
    });
    if (handle.toString() !== token) {
      throw invalid(spec, `${spec.label} handle token is not canonical`, { token });
    }
    return handle;
  }

  /** @returns {string} */
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

  /** @returns {object} */
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
}

function assertObject(value, spec) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(spec, `${spec.label} handle must be an object or canonical token`, { value });
  }
}

function assertEnvelope(value, spec) {
  assertVersion(value, spec);
  assertKind(value, spec);
  assertFormat(value, spec);
  assertCodec(value, spec);
}

function assertVersion(value, spec) {
  if (value.version !== undefined && value.version !== spec.version) {
    throw invalid(spec, `Unsupported ${spec.kind} handle version: ${value.version}`, { value });
  }
}

function assertKind(value, spec) {
  if (value.kind !== undefined && value.kind !== spec.kind) {
    throw createCasError(`Handle kind is not ${spec.kind}`, ErrorCodes.HANDLE_KIND_MISMATCH, {
      expectedKind: spec.kind,
      actualKind: value.kind,
    });
  }
}

function assertFormat(value, spec) {
  if (value.format !== undefined && value.format !== spec.format) {
    throw invalid(spec, `Unsupported ${spec.kind} handle format: ${value.format}`, { value });
  }
}

function assertCodec(value, spec) {
  const codec = spec.codec ?? value.codec;
  if (typeof codec !== 'string' || !CODEC_PATTERN.test(codec) || value.codec === '') {
    throw invalid(spec, `${spec.label} handle codec must be a canonical lowercase identifier`, {
      codec: value.codec,
    });
  }
  if (spec.codec !== undefined && value.codec !== undefined && value.codec !== spec.codec) {
    throw invalid(spec, `${spec.label} handle codec must be ${spec.codec}`, { codec: value.codec });
  }
}

function invalid(spec, message, meta) {
  return createCasError(message, ErrorCodes.HANDLE_INVALID, meta);
}
