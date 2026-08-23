import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import GitPersistenceAdapter, {
  DEFAULT_MAX_BLOB_SIZE,
} from '../../src/infrastructure/adapters/GitPersistenceAdapter.js';
import { createCountingGitPlumbing } from './createCountingGitPlumbing.js';

const DEFAULT_ITEMS = 32;
const DEFAULT_SMALL_BYTES = 4 * 1024;
const MAX_ITEMS = 256;
const MIN_SMALL_BYTES = 4;

const items = positiveInteger(process.argv[2] ?? DEFAULT_ITEMS, 'items');
const smallBytes = positiveInteger(process.argv[3] ?? DEFAULT_SMALL_BYTES, 'smallBytes');
assert(items <= MAX_ITEMS, `items must not exceed ${MAX_ITEMS}`);
assert(smallBytes >= MIN_SMALL_BYTES, `smallBytes must be at least ${MIN_SMALL_BYTES}`);
assert(smallBytes <= DEFAULT_MAX_BLOB_SIZE, `smallBytes must not exceed ${DEFAULT_MAX_BLOB_SIZE}`);

const repo = mkdtempSync(path.join(os.tmpdir(), 'cas-bounded-stream-measure-'));
try {
  git(repo, ['init', '--bare']);
  const smallSources = Array.from({ length: items }, (_, index) => smallSource(index, smallBytes));
  const smallOids = smallSources.map((source) => writeBlob(repo, source));
  const oversizedSource = Buffer.alloc(DEFAULT_MAX_BLOB_SIZE + 1, 0x5a);
  const oversizedOid = writeBlob(repo, oversizedSource);

  const fallback = await measureReads({ repo, oids: smallOids, sessions: false });
  const session = await measureReads({ repo, oids: smallOids, sessions: true });
  const oversized = await measureReads({ repo, oids: [oversizedOid], sessions: true });
  const expectedSmallDigest = digest(smallSources);
  const expectedOversizedDigest = digest([oversizedSource]);

  const laws = Object.freeze({
    smallSemanticEquality:
      fallback.semanticDigest === expectedSmallDigest &&
      session.semanticDigest === expectedSmallDigest,
    fallbackUsesOneShotPerBlob:
      fallback.processCounts['cat-file'] === items &&
      fallback.processCounts['session:cat-file'] === undefined,
    smallSessionUsesOneChild:
      session.processCounts['session:cat-file'] === 1 &&
      session.processCounts['cat-file'] === undefined,
    smallSessionReadsEveryBlob:
      session.sessionOperations['cat-file:info'] === items &&
      session.sessionOperations['cat-file:read'] === items,
    oversizedSemanticEquality: oversized.semanticDigest === expectedOversizedDigest,
    oversizedStreamsExactlyOnce:
      oversized.processCounts['session:cat-file'] === 1 &&
      oversized.processCounts['cat-file'] === 1 &&
      oversized.sessionOperations['cat-file:info'] === 1 &&
      oversized.sessionOperations['cat-file:read'] === undefined,
    everySessionCloses:
      Object.keys(session.activeSessionsAfterClose).length === 0 &&
      Object.keys(oversized.activeSessionsAfterClose).length === 0,
  });

  for (const [law, passed] of Object.entries(laws)) {
    assert.equal(passed, true, `bounded stream session law failed: ${law}`);
  }

  const report = {
    schema: 'git-cas.bounded-stream-session-reads/v1',
    generatedAt: new Date().toISOString(),
    sourceCommit: git(repoRoot(), ['rev-parse', 'HEAD']),
    environment: {
      node: process.version,
      git: git(repo, ['--version']),
      platform: process.platform,
      architecture: process.arch,
    },
    parameters: {
      items,
      smallBytes,
      sessionBufferCeilingBytes: DEFAULT_MAX_BLOB_SIZE,
      oversizedBytes: oversizedSource.byteLength,
    },
    smallReads: { fallback, session },
    oversizedRead: oversized,
    laws,
    nonclaims: [
      'Process counts are structural evidence, not a wall-clock guarantee.',
      'The 10 MiB ceiling is per admitted read, not an aggregate caller-residency bound.',
      'The oversized payload is streamed once after metadata inspection; no session content read occurs.',
    ],
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  rmSync(repo, { recursive: true, force: true });
}

async function measureReads({ repo: repository, oids, sessions }) {
  const counted = await createCountingGitPlumbing({ cwd: repository, sessions });
  const adapter = new GitPersistenceAdapter({ plumbing: counted.plumbing });
  const values = [];
  let processCounts;
  let sessionOperations;
  let activeSessionsBeforeClose;
  try {
    for (const oid of oids) {
      values.push(await collect(await adapter.readBlobStream(oid)));
    }
    processCounts = Object.fromEntries(counted.snapshot());
    sessionOperations = Object.fromEntries(counted.sessionOperations());
    activeSessionsBeforeClose = Object.fromEntries(counted.activeSessions());
  } finally {
    await adapter.close();
  }
  return {
    objectCount: values.length,
    contentBytes: values.reduce((total, value) => total + value.byteLength, 0),
    semanticDigest: digest(values),
    processCount: Object.values(processCounts).reduce((total, value) => total + value, 0),
    processCounts,
    sessionOperations,
    activeSessionsBeforeClose,
    activeSessionsAfterClose: Object.fromEntries(counted.activeSessions()),
  };
}

async function collect(iterable) {
  const chunks = [];
  for await (const chunk of iterable) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function smallSource(index, bytes) {
  const source = Buffer.alloc(bytes, index % 251);
  source.writeUInt32BE(index, 0);
  return source;
}

function writeBlob(cwd, source) {
  return git(cwd, ['hash-object', '-w', '--stdin'], source);
}

function git(cwd, args, input) {
  return execFileSync('git', args, { cwd, input, encoding: 'utf8' }).trim();
}

function repoRoot() {
  return fileURLToPath(new URL('../..', import.meta.url));
}

function digest(values) {
  const hash = createHash('sha256');
  for (const value of values) {
    const length = Buffer.allocUnsafe(8);
    length.writeBigUInt64BE(BigInt(value.byteLength));
    hash.update(length);
    hash.update(value);
  }
  return hash.digest('hex');
}

function positiveInteger(raw, label) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}
