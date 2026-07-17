import { Policy } from '@git-stunts/alfred';
import { CasError, ErrorCodes } from '../../domain/errors/index.js';
import Oid from '../../domain/value-objects/Oid.js';
import RepositoryInspectionPort from '../../ports/RepositoryInspectionPort.js';

const DEFAULT_POLICY = Policy.timeout(30_000);
const DEFAULT_FULL_SCAN_POLICY = Policy.timeout(5 * 60_000);
const OBJECT_TYPES = new Set(['blob', 'tree', 'commit', 'tag']);
const OBJECT_FORMAT = '--batch-check=%(objectname) %(objecttype) %(objectsize) %(objectsize:disk)';

/** Non-mutating repository inspection backed by safe Git plumbing commands. */
export default class GitRepositoryInspectionAdapter extends RepositoryInspectionPort {
  constructor({ plumbing, policy }) {
    super();
    if (
      typeof plumbing?.execute !== 'function' ||
      typeof plumbing?.executeStream !== 'function' ||
      typeof plumbing?.inspectPrunableObjects !== 'function'
    ) {
      throw new CasError(
        'Repository inspection requires GitPlumbing 3.1.0 or newer',
        ErrorCodes.REPOSITORY_INSPECTION_INVALID
      );
    }
    this.plumbing = plumbing;
    this.policy = policy ?? DEFAULT_POLICY;
    this.fullScanPolicy = policy ?? DEFAULT_FULL_SCAN_POLICY;
    Object.freeze(this);
  }

  async *iterateObjects() {
    const stream = await this.#stream({
      args: ['cat-file', '--batch-all-objects', OBJECT_FORMAT],
    });
    for await (const line of consumeLines(stream, 'object inventory')) {
      const fields = line.split(' ');
      if (fields.length !== 4) {
        throw invalidOutput('object inventory', line);
      }
      const [oid, type] = fields;
      yield Object.freeze({
        oid: parseOid(oid, 'object inventory', line),
        type: parseType(type, 'object inventory', line),
        logicalBytes: parseBytes(fields[2], 'object inventory', line),
        physicalBytes: parseBytes(fields[3], 'object inventory', line),
      });
    }
  }

  async *iterateReachableObjectIds() {
    const stream = await this.#stream({
      args: ['rev-list', '--all', '--reflog', '--objects', '--no-object-names'],
    });
    for await (const line of consumeLines(stream, 'reachable object inventory')) {
      yield parseOid(line, 'reachable object inventory', line);
    }
  }

  async *iteratePrunableObjects({ expiresBefore }) {
    const stream = await this.policy.execute(() =>
      this.plumbing.inspectPrunableObjects({ expiresBefore })
    );
    for await (const line of consumeLines(stream, 'prunable object inspection')) {
      const fields = line.trim().split(/\s+/u);
      if (fields.length !== 2) {
        throw invalidOutput('prunable object inspection', line);
      }
      yield Object.freeze({
        oid: parseOid(fields[0], 'prunable object inspection', line),
        type: parseType(fields[1], 'prunable object inspection', line),
      });
    }
  }

  async *iterateRefs({ prefix = 'refs/' } = {}) {
    if (typeof prefix !== 'string' || !prefix.startsWith('refs/') || prefix.includes('..')) {
      throw new CasError(
        'Git ref inventory prefix is invalid',
        ErrorCodes.REPOSITORY_INSPECTION_INVALID,
        { prefix },
      );
    }
    const stream = await this.#stream({
      args: ['for-each-ref', '--format=%(refname)%09%(objectname)', prefix],
    });
    for await (const line of consumeLines(stream, 'ref inventory')) {
      const fields = line.split('\t');
      if (fields.length !== 2 || !fields[0].startsWith('refs/')) {
        throw invalidOutput('ref inventory', line);
      }
      yield Object.freeze({
        ref: fields[0],
        oid: parseOid(fields[1], 'ref inventory', line),
      });
    }
  }

  async reachablePhysicalBytes() {
    const output = await this.fullScanPolicy.execute(() =>
      this.plumbing.execute({
        args: ['rev-list', '--all', '--reflog', '--objects', '--disk-usage'],
      })
    );
    return parseBytes(String(output).trim(), 'reachable disk usage', output);
  }

  async #stream(options) {
    return await this.policy.execute(() => this.plumbing.executeStream(options));
  }
}

async function* consumeLines(stream, operation) {
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
    throw new CasError(`Git ${operation} failed`, ErrorCodes.REPOSITORY_INSPECTION_INVALID, {
      operation,
      stderr: result?.stderr,
    });
  }
}

function parseOid(value, operation, output) {
  if (!Oid.isValid(value)) {
    throw invalidOutput(operation, output);
  }
  return Oid.from(value).toString();
}

function parseType(value, operation, output) {
  if (!OBJECT_TYPES.has(value)) {
    throw invalidOutput(operation, output);
  }
  return value;
}

function parseBytes(value, operation, output) {
  if (!/^\d+$/u.test(String(value))) {
    throw invalidOutput(operation, output);
  }
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes)) {
    throw invalidOutput(operation, output);
  }
  return bytes;
}

function invalidOutput(operation, output) {
  return new CasError(
    `Git ${operation} returned invalid structured output`,
    ErrorCodes.REPOSITORY_INSPECTION_INVALID,
    { operation, output: String(output) }
  );
}
