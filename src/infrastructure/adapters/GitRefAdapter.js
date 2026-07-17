import { Policy } from '@git-stunts/alfred';
import GitRefPort from '../../ports/GitRefPort.js';
import { CasError, ErrorCodes } from '../../domain/errors/index.js';
import { errorDetailsText, isGitMissingRefError } from '../../domain/helpers/gitRefErrors.js';
import Oid from '../../domain/value-objects/Oid.js';

/**
 * Default resilience policy: 30 s timeout (no retry).
 *
 * Plumbing already retries lock-contention errors internally via
 * {@link ExecutionOrchestrator}, so an additional alfred retry layer is
 * unnecessary and causes premature process exit: alfred's retry sleep uses
 * an unref'd timer that allows Node to exit before the next attempt starts.
 */
const DEFAULT_POLICY = Policy.timeout(30_000);
const FORBIDDEN_REF_CHARACTERS = new Set(['~', '^', ':', '?', '*', '[', '\\']);
const MAX_REF_ITERATION_LIMIT = 1001;

/**
 * {@link GitRefPort} implementation backed by `@git-stunts/plumbing`.
 *
 * All Git I/O is wrapped with a configurable resilience {@link Policy}
 * (30 s timeout by default).
 */
export default class GitRefAdapter extends GitRefPort {
  /**
   * @param {Object} options
   * @param {import('@git-stunts/plumbing').default} options.plumbing - GitPlumbing instance.
   * @param {import('@git-stunts/alfred').Policy} [options.policy] - Resilience policy.
   */
  constructor({ plumbing, policy }) {
    super();
    this.plumbing = plumbing;
    this.policy = policy ?? DEFAULT_POLICY;
  }

  /**
   * @override
   * @param {string} ref - Git ref to resolve.
   * @returns {Promise<string>} The commit OID.
   */
  async resolveRef(ref) {
    try {
      return await this.policy.execute(() =>
        this.plumbing.execute({ args: ['rev-parse', ref] }),
      );
    } catch (err) {
      if (isGitMissingRefError(err, ref)) {
        throw new CasError(`Git ref not found: ${ref}`, ErrorCodes.GIT_REF_NOT_FOUND, {
          ref,
          originalError: err,
        });
      }
      throw err;
    }
  }

  /**
   * @override
   * @param {string} commitOid - Git commit OID.
   * @returns {Promise<string>} The tree OID.
   */
  async resolveTree(commitOid) {
    return this.policy.execute(() =>
      this.plumbing.execute({ args: ['rev-parse', `${commitOid}^{tree}`] }),
    );
  }

  /**
   * @override
   * @param {string} commitOid - Git commit OID.
   * @returns {Promise<string[]>} Direct parent OIDs.
   */
  async resolveParents(commitOid) {
    const line = await this.policy.execute(() =>
      this.plumbing.execute({ args: ['rev-list', '--parents', '-n', '1', commitOid] }),
    );
    const [resolvedCommit, ...parents] = line.trim().split(/\s+/u);
    if (!resolvedCommit) {
      throw new CasError(
        `Git commit not found: ${commitOid}`,
        ErrorCodes.GIT_ERROR,
        { commitOid },
      );
    }
    return parents;
  }

  /**
   * @override
   * @param {Object} options
   * @param {string} options.treeOid - Tree OID for the commit.
   * @param {string|null} [options.parentOid] - Parent commit OID.
   * @param {string[]} [options.parentOids] - Ordered parent commit OIDs.
   * @param {string} options.message - Commit message.
   * @returns {Promise<string>} The new commit OID.
   */
  async createCommit({ treeOid, parentOid, parentOids, message }) {
    const args = ['commit-tree', treeOid, '-m', message];
    const parents = parentOids ?? (parentOid ? [parentOid] : []);
    for (const parent of parents) {
      args.push('-p', parent);
    }
    return this.policy.execute(() =>
      this.plumbing.execute({ args }),
    );
  }

  /**
   * @override
   * @param {Object} options
   * @param {string} options.ref - Git ref to update.
   * @param {string} options.newOid - New OID to set.
   * @param {string|null} [options.expectedOldOid] - Expected current OID for CAS; `null` means the ref must not exist.
   * @returns {Promise<void>}
   */
  async updateRef({ ref, newOid, expectedOldOid }) {
    const args = ['update-ref', ref, newOid];
    if (expectedOldOid !== undefined) {
      args.push(expectedOldOid ?? '0'.repeat(newOid.length));
    }
    await this.policy.execute(() =>
      this.plumbing.execute({ args }),
    );
  }

  /** @override */
  async anchorRef({ sourceRef, expectedSourceOid, targetRef }) {
    assertRefName(sourceRef);
    assertRefName(targetRef);
    const generation = Oid.from(expectedSourceOid).toString();
    if (
      await this.#resolveSymbolicRef(sourceRef) !== null ||
      await this.#resolveSymbolicRef(targetRef) !== null
    ) {
      return false;
    }
    const input = [
      'start',
      `verify ${sourceRef} ${generation}`,
      `create ${targetRef} ${generation}`,
      'prepare',
      'commit',
      '',
    ].join('\n');
    try {
      await this.policy.execute(() =>
        this.plumbing.execute({ args: ['update-ref', '--no-deref', '--stdin'], input }),
      );
      return true;
    } catch (error) {
      if (isUpdateRefConflict(error, [sourceRef, targetRef])) {
        return false;
      }
      throw error;
    }
  }

  /** @override */
  async deleteRef({ ref, expectedOldOid }) {
    assertRefName(ref);
    const expectedGeneration = Oid.from(expectedOldOid).toString();
    const symbolicTarget = await this.#resolveSymbolicRef(ref);
    if (symbolicTarget !== null) {
      throw refConflict({
        ref,
        expectedOldOid: expectedGeneration,
        actualOldOid: null,
        actualSymref: symbolicTarget,
      });
    }
    try {
      await this.policy.execute(() =>
        this.plumbing.execute({
          args: ['update-ref', '--no-deref', '-d', ref, expectedGeneration],
        }),
      );
    } catch (error) {
      if (!isUpdateRefConflict(error, [ref])) {
        throw error;
      }
      const actual = await this.#inspectDirectRef(ref);
      if (actual === null) {
        return false;
      }
      throw refConflict({
        ref,
        expectedOldOid: expectedGeneration,
        actualOldOid: actual.oid,
        actualSymref: actual.symref,
        originalError: error,
      });
    }
    return true;
  }

  /** @override */
  async *iterateRefs({ prefix = 'refs/', limit } = {}) {
    assertRefPrefix(prefix);
    assertRefIterationLimit(limit);
    if (typeof this.plumbing?.executeStream !== 'function') {
      throw new CasError(
        'Git ref inventory requires streaming plumbing',
        ErrorCodes.GIT_ERROR,
        { prefix },
      );
    }
    const stream = await this.policy.execute(() =>
      this.plumbing.executeStream({
        args: [
          'for-each-ref',
          '--format=%(refname)%09%(objectname)%09%(symref)',
          `--count=${limit}`,
          prefix,
        ],
      }),
    );
    for await (const line of consumeRefLines(stream)) {
      yield parseIteratedRef(prefix, line);
    }
  }

  async #inspectDirectRef(ref) {
    const output = await this.policy.execute(() =>
      this.plumbing.execute({
        args: [
          'for-each-ref',
          '--format=%(refname)%09%(objectname)%09%(symref)',
          '--count=1',
          ref,
        ],
      }),
    );
    const line = String(output).replace(/\r?\n$/u, '');
    if (line.length === 0) {
      return null;
    }
    const fields = line.split('\t');
    if (
      (fields.length !== 2 && fields.length !== 3) ||
      fields[0] !== ref ||
      !Oid.isValid(fields[1]) ||
      (fields[2] !== undefined && fields[2] !== '' && !isValidRefSyntax(fields[2], false))
    ) {
      throw invalidRefInventory(ref, line);
    }
    return Object.freeze({
      ref,
      oid: Oid.from(fields[1]).toString(),
      symref: fields[2] || null,
    });
  }

  async #resolveSymbolicRef(ref) {
    try {
      const output = await this.policy.execute(() =>
        this.plumbing.execute({ args: ['symbolic-ref', '--quiet', ref] }),
      );
      const target = String(output).trim();
      return target.length > 0 ? target : null;
    } catch (error) {
      if (isQuietSymbolicRefMiss(error, ref)) {
        return null;
      }
      throw error;
    }
  }
}

function assertRefPrefix(prefix) {
  assertRefSyntax(prefix, { allowTrailingSlash: true });
}

function assertRefName(ref) {
  assertRefSyntax(ref, { allowTrailingSlash: false });
}

function assertRefIterationLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REF_ITERATION_LIMIT) {
    throw new CasError(
      `Git ref inventory limit must be between 1 and ${MAX_REF_ITERATION_LIMIT}`,
      ErrorCodes.GIT_ERROR,
      { limit },
    );
  }
}

function assertRefSyntax(value, { allowTrailingSlash }) {
  if (typeof value !== 'string' || !isValidRefSyntax(value, allowTrailingSlash)) {
    throw invalidRefName(value);
  }
}

function isValidRefSyntax(value, allowTrailingSlash) {
  if (!value.startsWith('refs/') || (!allowTrailingSlash && value.endsWith('/'))) {
    return false;
  }
  if (['//', '..', '@{'].some((pattern) => value.includes(pattern))) {
    return false;
  }
  if (value.endsWith('.') || hasForbiddenRefCharacter(value)) {
    return false;
  }
  const trimmed = allowTrailingSlash && value.endsWith('/') ? value.slice(0, -1) : value;
  return !trimmed.split('/').some(isInvalidRefSegment);
}

function isInvalidRefSegment(part) {
  return part.length === 0 || part.startsWith('.') || part.endsWith('.lock');
}

function hasForbiddenRefCharacter(value) {
  return typeof value === 'string' && [...value].some((character) => {
    const code = character.codePointAt(0);
    return code <= 0x20 || code === 0x7f || FORBIDDEN_REF_CHARACTERS.has(character);
  });
}

async function* consumeRefLines(stream) {
  const decoder = new globalThis.TextDecoder();
  let pending = '';
  for await (const chunk of stream) {
    pending += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let newline = pending.indexOf('\n');
    while (newline !== -1) {
      const line = pending.slice(0, newline).replace(/\r$/u, '');
      pending = pending.slice(newline + 1);
      if (line.length > 0) {
        yield line;
      }
      newline = pending.indexOf('\n');
    }
  }
  pending += decoder.decode();
  if (pending.length > 0) {
    yield pending.replace(/\r$/u, '');
  }
  const result = await stream.finished;
  if (result?.code !== 0) {
    throw new CasError('Git ref inventory failed', ErrorCodes.GIT_ERROR, {
      stderr: result?.stderr,
    });
  }
}

function invalidRefInventory(prefix, output) {
  return new CasError(
    'Git ref inventory returned invalid structured output',
    ErrorCodes.GIT_ERROR,
    { prefix, output: String(output) },
  );
}

function parseIteratedRef(prefix, line) {
  const fields = line.split('\t');
  if (!isValidIteratedRef(fields, prefix)) {
    throw invalidRefInventory(prefix, line);
  }
  return Object.freeze({
    ref: fields[0],
    oid: Oid.from(fields[1]).toString(),
    symref: fields[2] || null,
  });
}

function isValidIteratedRef(fields, prefix) {
  return fields.length === 3
    && fields[0].startsWith(prefix)
    && Oid.isValid(fields[1])
    && (fields[2] === '' || isValidRefSyntax(fields[2], false));
}

function invalidRefName(ref) {
  return new CasError('Git ref name or prefix is invalid', ErrorCodes.GIT_ERROR, { ref });
}

function isUpdateRefConflict(error, refs) {
  const text = errorDetailsText(error).toLowerCase();
  return refs.some((ref) => text.includes(ref.toLowerCase()))
    && (
      text.includes('cannot lock ref') ||
      text.includes('but expected') ||
      text.includes('reference already exists') ||
      text.includes('unable to resolve reference') ||
      text.includes('zero <oldvalue>') ||
      text.includes('is a symref')
    );
}

function isQuietSymbolicRefMiss(error, ref) {
  const details = error instanceof Error && error.details && typeof error.details === 'object'
    ? error.details
    : {};
  return details.code === 1
    && Array.isArray(details.args)
    && details.args[0] === 'symbolic-ref'
    && details.args.at(-1) === ref;
}

function refConflict({
  ref,
  expectedOldOid,
  actualOldOid,
  actualSymref = null,
  originalError,
}) {
  return new CasError(
    `Git ref changed before checked deletion: ${ref}`,
    ErrorCodes.GIT_REF_CONFLICT,
    { ref, expectedOldOid, actualOldOid, actualSymref, originalError },
  );
}
