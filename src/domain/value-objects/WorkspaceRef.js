import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import CollectionNamespace from './CollectionNamespace.js';

export const WORKSPACE_REF_PREFIX = 'refs/cas/workspaces/';
const WORKSPACE_ID = /^v1-([a-z0-9]+)-([a-f0-9]{32})$/;
const NONCE_BYTES = 16;

/** Immutable ref identifying one scoped staging workspace. */
export default class WorkspaceRef {
  #createdAt;
  #id;
  #namespace;
  #value;

  constructor(value) {
    const parsed = WorkspaceRef.#parse(value);
    this.#namespace = parsed.namespace;
    this.#id = parsed.id;
    this.#createdAt = parsed.createdAt;
    this.#value = parsed.value;
    Object.freeze(this);
  }

  static from(value) {
    return value instanceof WorkspaceRef ? value : new WorkspaceRef(value);
  }

  static create({ namespace: value, createdAt, nonce }) {
    const namespace = CollectionNamespace.from(value).toString();
    const created = WorkspaceRef.#canonicalTimestamp(createdAt);
    if (!(nonce instanceof Uint8Array) || nonce.length !== NONCE_BYTES) {
      throw WorkspaceRef.#invalid('Workspace nonce must contain exactly 16 bytes', {
        nonceLength: nonce?.length,
      });
    }
    const epoch = String(created.getTime().toString(36));
    const nonceHex = [...nonce]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const id = `v1-${epoch}-${nonceHex}`;
    return new WorkspaceRef(
      `${WORKSPACE_REF_PREFIX}${WorkspaceRef.#encodeNamespace(namespace)}/${id}`,
    );
  }

  static prefixForNamespace(value) {
    const namespace = CollectionNamespace.from(value).toString();
    return `${WORKSPACE_REF_PREFIX}${WorkspaceRef.#encodeNamespace(namespace)}/`;
  }

  get namespace() {
    return this.#namespace;
  }

  get id() {
    return this.#id;
  }

  get createdAt() {
    return this.#createdAt;
  }

  toString() {
    return this.#value;
  }

  static #parse(value) {
    const [encodedNamespace, id] = WorkspaceRef.#split(value);
    const namespace = WorkspaceRef.#decodeNamespace(encodedNamespace, value);
    const createdAt = WorkspaceRef.#createdAtFromId(id, value);
    return { namespace, id, createdAt, value };
  }

  static #split(value) {
    if (typeof value !== 'string' || !value.startsWith(WORKSPACE_REF_PREFIX)) {
      throw WorkspaceRef.#invalid(`Workspace ref must be below ${WORKSPACE_REF_PREFIX}`, {
        ref: value,
      });
    }
    const fields = value.slice(WORKSPACE_REF_PREFIX.length).split('/');
    if (fields.length !== 2 || fields.some((field) => field.length === 0)) {
      throw WorkspaceRef.#invalid('Workspace ref must contain one encoded namespace and ID', {
        ref: value,
      });
    }
    return fields;
  }

  static #decodeNamespace(encodedNamespace, value) {
    if (encodedNamespace.includes('++')) {
      throw WorkspaceRef.#invalid('Workspace ref contains a malformed encoded namespace', {
        ref: value,
      });
    }
    let namespace;
    try {
      namespace = CollectionNamespace.from(encodedNamespace.replaceAll('+', '/')).toString();
    } catch (error) {
      throw WorkspaceRef.#invalid('Workspace ref contains an invalid encoded namespace', {
        ref: value,
        originalError: error,
      });
    }
    if (WorkspaceRef.#encodeNamespace(namespace) !== encodedNamespace) {
      throw WorkspaceRef.#invalid('Workspace ref namespace is not canonical', { ref: value });
    }
    return namespace;
  }

  static #createdAtFromId(id, value) {
    const idMatch = WORKSPACE_ID.exec(id);
    if (!idMatch) {
      throw WorkspaceRef.#invalid('Workspace ref contains an invalid workspace ID', { ref: value });
    }
    const epoch = Number.parseInt(idMatch[1], 36);
    if (!Number.isSafeInteger(epoch) || epoch < 0 || epoch.toString(36) !== idMatch[1]) {
      throw WorkspaceRef.#invalid('Workspace ref contains an invalid creation epoch', { ref: value });
    }
    const createdAt = new Date(epoch);
    if (Number.isNaN(createdAt.getTime())) {
      throw WorkspaceRef.#invalid('Workspace ref creation epoch is outside the Date range', {
        ref: value,
      });
    }
    return createdAt.toISOString();
  }

  static #canonicalTimestamp(value) {
    if (typeof value !== 'string') {
      throw WorkspaceRef.#invalid('Workspace creation time must be a canonical timestamp', {
        createdAt: value,
      });
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
      throw WorkspaceRef.#invalid('Workspace creation time must be a canonical timestamp', {
        createdAt: value,
      });
    }
    return date;
  }

  static #encodeNamespace(namespace) {
    return namespace.replaceAll('/', '+');
  }

  static #invalid(message, meta) {
    return createCasError(message, ErrorCodes.WORKSPACE_REF_INVALID, meta);
  }
}
