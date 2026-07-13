import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import { utf8Encode } from '../encoding/utf8.js';
import Oid from '../value-objects/Oid.js';
import RetentionWitness from '../value-objects/RetentionWitness.js';

const DEFAULT_CLOCK = Object.freeze({ now: () => new Date() });
const FORBIDDEN_REF_CHARS = '~^:?*[\\';
const MAX_COMMIT_MESSAGE_BYTES = 1024 * 1024;
const MAX_PARENTS = 64;

/**
 * Publishes validated content roots through application-owned Git refs.
 */
export default class PublicationService {
  #applicationRefPrefixes;
  #clock;
  #ref;
  #resolveRoot;

  /**
   * @param {object} options
   * @param {import('../../ports/GitRefPort.js').default} options.ref
   * @param {(handle: unknown) => Promise<object>} options.resolveRoot
   * @param {string[]} [options.applicationRefPrefixes]
   * @param {{ now(): Date }} [options.clock]
   */
  constructor({ ref, resolveRoot, applicationRefPrefixes = [], clock = DEFAULT_CLOCK }) {
    PublicationService.#assertDependencies(ref, resolveRoot, clock);
    this.#applicationRefPrefixes = PublicationService.#normalizePrefixes(applicationRefPrefixes);
    this.#ref = ref;
    this.#resolveRoot = resolveRoot;
    this.#clock = clock;
  }

  /**
   * @param {object} options
   * @param {unknown} options.root
   * @param {{ message: string, parents?: string[] }} options.commit
   * @param {{ name: string, expected: string|null }} options.ref
   * @returns {Promise<object>}
   */
  async commit({ root: handle, commit, ref }) {
    const namespace = this.#authorizeRef(ref?.name);
    const expected = PublicationService.#normalizeExpected(ref);
    const message = PublicationService.#normalizeMessage(commit?.message);
    const parentOids = await this.#normalizeParents(commit?.parents ?? []);
    const target = await this.#resolveRoot(handle);
    PublicationService.#assertTreeRoot(target);

    const commitId = await this.#ref.createCommit({
      treeOid: target.oid,
      parentOids,
      message,
    });
    await this.#updateRef({ ref: ref.name, commitId, expected });

    const witness = new RetentionWitness({
      handle: target.handle,
      policy: 'pinned',
      reachability: 'anchored',
      root: {
        kind: 'publication',
        namespace,
        ref: ref.name,
        generation: commitId,
        path: '/',
      },
      observedAt: this.#observedAt(),
    });
    return Object.freeze({
      operation: 'publication',
      commitId,
      ref: ref.name,
      root: target.handle,
      witness,
    });
  }

  async #normalizeParents(values) {
    if (!Array.isArray(values) || values.length > MAX_PARENTS) {
      throw PublicationService.#invalid('Publication parents must be a bounded array', {
        parentCount: values?.length,
        maxParents: MAX_PARENTS,
      });
    }
    const parents = values.map((value) => PublicationService.#normalizeOid(value, 'parent'));
    for (const parent of parents) {
      try {
        await this.#ref.resolveParents(parent);
      } catch (error) {
        throw PublicationService.#invalid('Publication parent is not a readable commit', {
          parent,
          originalError: error,
        });
      }
    }
    return parents;
  }

  async #updateRef({ ref, commitId, expected }) {
    try {
      await this.#ref.updateRef({
        ref,
        newOid: commitId,
        expectedOldOid: expected,
      });
    } catch (error) {
      let observed;
      try {
        observed = await this.#resolveObserved(ref);
      } catch (observationError) {
        throw createCasError(
          'Application publication ref update failed and the current head could not be observed',
          ErrorCodes.PUBLICATION_REF_UPDATE_FAILED,
          { ref, expected, attemptedCommitId: commitId, originalError: error, observationError }
        );
      }
      if (observed !== expected) {
        throw createCasError('Application publication conflict', ErrorCodes.PUBLICATION_CONFLICT, {
          ref,
          expected,
          observed,
          attemptedCommitId: commitId,
          originalError: error,
        });
      }
      throw createCasError(
        'Application publication ref update failed',
        ErrorCodes.PUBLICATION_REF_UPDATE_FAILED,
        { ref, expected, observed, attemptedCommitId: commitId, originalError: error }
      );
    }
  }

  async #resolveObserved(ref) {
    try {
      return await this.#ref.resolveRef(ref);
    } catch (error) {
      if (error?.code === ErrorCodes.GIT_REF_NOT_FOUND) {
        return null;
      }
      throw error;
    }
  }

  #authorizeRef(value) {
    if (!PublicationService.#isValidRef(value) || value.startsWith('refs/cas/')) {
      throw PublicationService.#forbidden(value);
    }
    const namespace = this.#applicationRefPrefixes.find((prefix) => value.startsWith(prefix));
    if (!namespace) {
      throw PublicationService.#forbidden(value);
    }
    return namespace;
  }

  #observedAt() {
    const now = this.#clock.now();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw PublicationService.#invalid('PublicationService clock returned an invalid Date');
    }
    return now.toISOString();
  }

  static #normalizeExpected(ref) {
    if (!ref || !Object.hasOwn(ref, 'expected')) {
      throw PublicationService.#invalid('Publication ref requires an explicit expected head', {
        ref,
      });
    }
    return ref.expected === null
      ? null
      : PublicationService.#normalizeOid(ref.expected, 'expected');
  }

  static #normalizeMessage(value) {
    const size = typeof value === 'string' ? utf8Encode(value).length : -1;
    if (size < 1 || size > MAX_COMMIT_MESSAGE_BYTES || value.includes('\0')) {
      throw PublicationService.#invalid('Publication commit message is invalid', {
        messageBytes: size,
        maxMessageBytes: MAX_COMMIT_MESSAGE_BYTES,
      });
    }
    return value;
  }

  static #normalizePrefixes(prefixes) {
    if (!Array.isArray(prefixes)) {
      throw PublicationService.#invalid('Application ref prefixes must be an array', { prefixes });
    }
    const normalized = [...new Set(prefixes)];
    for (const prefix of normalized) {
      if (
        !PublicationService.#isValidRef(`${prefix}placeholder`) ||
        !prefix.endsWith('/') ||
        prefix.startsWith('refs/cas/')
      ) {
        throw PublicationService.#invalid('Application ref prefix is invalid or reserved', {
          prefix,
        });
      }
    }
    normalized.sort((left, right) => {
      const lengthOrder = right.length - left.length;
      if (lengthOrder !== 0) {
        return lengthOrder;
      }
      return left < right ? -1 : left > right ? 1 : 0;
    });
    return Object.freeze(normalized);
  }

  static #isValidRef(value) {
    if (
      PublicationService.#hasInvalidRefShape(value) ||
      PublicationService.#hasForbiddenRefCharacter(value)
    ) {
      return false;
    }
    return value
      .split('/')
      .every((part) => part.length > 0 && part !== '.' && part !== '..' && !part.endsWith('.lock'));
  }

  static #hasInvalidRefShape(value) {
    return (
      typeof value !== 'string' ||
      !value.startsWith('refs/') ||
      value.endsWith('/') ||
      value.endsWith('.') ||
      value.includes('//') ||
      value.includes('..') ||
      value.includes('@{')
    );
  }

  static #hasForbiddenRefCharacter(value) {
    if (typeof value !== 'string') {
      return true;
    }
    for (const character of value) {
      const codePoint = character.codePointAt(0);
      if (codePoint <= 0x20 || codePoint === 0x7f || FORBIDDEN_REF_CHARS.includes(character)) {
        return true;
      }
    }
    return false;
  }

  static #normalizeOid(value, field) {
    try {
      return Oid.from(value).toString();
    } catch (error) {
      throw PublicationService.#invalid(`Publication ${field} is not a valid object identifier`, {
        field,
        value,
        originalError: error,
      });
    }
  }

  static #assertTreeRoot(target) {
    if (!target || target.type !== 'tree') {
      throw createCasError(
        'Publication root must resolve to a Git tree',
        ErrorCodes.HANDLE_TARGET_TYPE_MISMATCH,
        { expectedType: 'tree', actualType: target?.type ?? null }
      );
    }
  }

  static #assertDependencies(ref, resolveRoot, clock) {
    const methods = ['resolveRef', 'resolveParents', 'createCommit', 'updateRef'];
    if (!ref || methods.some((method) => typeof ref[method] !== 'function')) {
      throw PublicationService.#invalid('PublicationService requires a complete Git ref port');
    }
    if (typeof resolveRoot !== 'function') {
      throw PublicationService.#invalid('PublicationService requires a handle resolver');
    }
    if (!clock || typeof clock.now !== 'function') {
      throw PublicationService.#invalid('PublicationService clock must provide now()');
    }
  }

  static #forbidden(ref) {
    return createCasError(
      'Application publication ref is invalid, reserved, or not configured',
      ErrorCodes.PUBLICATION_REF_FORBIDDEN,
      { ref }
    );
  }

  static #invalid(message, meta = {}) {
    return createCasError(message, ErrorCodes.PUBLICATION_INVALID, meta);
  }
}
