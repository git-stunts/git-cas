import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import { utf8Decode, utf8Encode } from '../encoding/utf8.js';
import WorkspaceRef from '../value-objects/WorkspaceRef.js';

export const WORKSPACE_DESCRIPTOR_ENTRY = '@workspace/lease';
export const WORKSPACE_DESCRIPTOR_VERSION = 1;
export const MAX_WORKSPACE_TARGETS = 100_000;

/** Canonical codec for the lease page retained by every installed workspace. */
export default class WorkspaceDescriptorCodec {
  encode(value) {
    return utf8Encode(JSON.stringify(this.create(value), null, 2));
  }

  decode(bytes, { expectedRef } = {}) {
    let value;
    try {
      value = JSON.parse(utf8Decode(bytes));
    } catch (error) {
      throw WorkspaceDescriptorCodec.#invalid('Workspace descriptor is not valid JSON', {
        originalError: error,
      });
    }
    const canonical = this.create(value);
    if (expectedRef !== undefined && canonical.ref !== WorkspaceRef.from(expectedRef).toString()) {
      throw WorkspaceDescriptorCodec.#invalid(
        'Workspace descriptor does not match the requested ref',
        { expectedRef, actualRef: canonical.ref },
      );
    }
    if (JSON.stringify(value) !== JSON.stringify(canonical)) {
      throw WorkspaceDescriptorCodec.#invalid('Workspace descriptor is not canonical', { value });
    }
    return canonical;
  }

  create(value) {
    WorkspaceDescriptorCodec.#assertObject(value);
    const {
      version = WORKSPACE_DESCRIPTOR_VERSION,
      ref: refValue,
      workspaceId,
      namespace,
      createdAt,
      expiresAt,
      targetCount,
    } = value;
    const ref = WorkspaceDescriptorCodec.#workspaceRef(refValue);
    WorkspaceDescriptorCodec.#assertVersion(version);
    WorkspaceDescriptorCodec.#assertIdentity({ ref, workspaceId, namespace });
    WorkspaceDescriptorCodec.#assertTimeRange({ ref, createdAt, expiresAt });
    WorkspaceDescriptorCodec.#assertTargetCount(targetCount);
    return {
      version: WORKSPACE_DESCRIPTOR_VERSION,
      ref: ref.toString(),
      workspaceId: ref.id,
      namespace: ref.namespace,
      createdAt,
      expiresAt,
      targetCount,
    };
  }

  static #assertObject(value) {
    const prototype = value && typeof value === 'object' ? Object.getPrototypeOf(value) : null;
    if (!value || Array.isArray(value)
      || (prototype !== Object.prototype && prototype !== null)) {
      throw WorkspaceDescriptorCodec.#invalid('Workspace descriptor must be a plain object', {
        value,
      });
    }
  }

  static #workspaceRef(value) {
    try {
      return WorkspaceRef.from(value);
    } catch (error) {
      throw WorkspaceDescriptorCodec.#invalid('Workspace descriptor ref is invalid', {
        ref: value,
        originalError: error,
      });
    }
  }

  static #assertVersion(version) {
    if (version !== WORKSPACE_DESCRIPTOR_VERSION) {
      throw WorkspaceDescriptorCodec.#invalid(
        `Unsupported workspace descriptor version: ${version}`,
        { version },
      );
    }
  }

  static #assertIdentity({ ref, workspaceId, namespace }) {
    if (workspaceId !== undefined && workspaceId !== ref.id) {
      throw WorkspaceDescriptorCodec.#invalid('Workspace descriptor ID does not match its ref', {
        workspaceId,
        ref: ref.toString(),
      });
    }
    if (namespace !== undefined && namespace !== ref.namespace) {
      throw WorkspaceDescriptorCodec.#invalid(
        'Workspace descriptor namespace does not match its ref',
        { namespace, ref: ref.toString() },
      );
    }
  }

  static #assertTimeRange({ ref, createdAt, expiresAt }) {
    WorkspaceDescriptorCodec.#assertTimestamp(createdAt, 'creation');
    WorkspaceDescriptorCodec.#assertTimestamp(expiresAt, 'expiry');
    if (createdAt !== ref.createdAt || Date.parse(expiresAt) <= Date.parse(createdAt)) {
      throw WorkspaceDescriptorCodec.#invalid('Workspace descriptor time range is invalid', {
        createdAt,
        expiresAt,
        ref: ref.toString(),
      });
    }
  }

  static #assertTargetCount(targetCount) {
    if (!Number.isSafeInteger(targetCount) || targetCount < 0 || targetCount > MAX_WORKSPACE_TARGETS) {
      throw WorkspaceDescriptorCodec.#invalid('Workspace target count is outside supported bounds', {
        targetCount,
        maxTargetCount: MAX_WORKSPACE_TARGETS,
      });
    }
  }

  static #assertTimestamp(value, label) {
    const date = typeof value === 'string' ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime()) || date.toISOString() !== value) {
      throw WorkspaceDescriptorCodec.#invalid(
        `Workspace ${label} time must be a canonical UTC timestamp`,
        { value },
      );
    }
  }

  static #invalid(message, meta) {
    return createCasError(message, ErrorCodes.WORKSPACE_DESCRIPTOR_INVALID, meta);
  }
}
