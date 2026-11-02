import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import ContentAddressableStore from '../../index.js';
import { createCountingGitPlumbing } from './createCountingGitPlumbing.js';

const BINDING = 'a'.repeat(64);
const PAGE_BYTES = 4096;
const identity = (key) => ({ key, binding: BINDING });
const policy = (records) => ({ namespace: 'measurement/reservations', capacity: { unit: 'record-slot', limit: records + 1 } });

export const RESERVATION_MEASUREMENTS = Object.freeze([
  'inspect-oldest', 'read-original', 'filtered-list', 'reserve', 'prepare',
  'arm', 'retry-arm', 'settle', 'capacity-refusal', 'read-final-after-gc',
]);

function page(index, stage) {
  const bytes = new Uint8Array(PAGE_BYTES).fill(stage);
  new DataView(bytes.buffer).setUint32(0, index);
  return bytes;
}

/** Seed in a separate process, so its allocations cannot inflate measurement RSS. */
export async function seedReservationMeasurement({ repo, records }) {
  const cas = await ContentAddressableStore.open({ cwd: repo });
  try {
    const namespace = await cas.reservations.open(policy(records));
    assert.equal(namespace.status, 'opened');
    for (let index = 0; index < records; index++) {
      const attempt = identity(`record-${index}`);
      assert.equal((await namespace.reserve(attempt)).status, 'admitted');
      assert.equal((await namespace.prepare({ ...attempt, evidence: { record: page(index, 1) } })).status, 'prepared');
      assert.equal((await namespace.arm(attempt)).status, 'armed');
      assert.equal((await namespace.settle({ ...attempt, evidence: { record: page(index, 2) } })).status, 'settled');
    }
    return { seeded: records };
  } finally {
    await cas.close();
  }
}

/** Real public facade with the existing counting wrapper around native Plumbing. */
export async function measureReservationOperation({ repo, records, operation }) {
  assert(RESERVATION_MEASUREMENTS.includes(operation));
  const counted = await createCountingGitPlumbing({ cwd: repo, sessions: true });
  const cas = new ContentAddressableStore({ plumbing: counted.plumbing });
  let measured;
  try {
    const namespace = await cas.reservations.open(policy(records));
    assert.equal(namespace.status, 'opened');
    const before = { processes: counted.snapshot(), requests: counted.sessionOperations() };
    const started = performance.now();
    const result = await execute(namespace, operation);
    measured = {
      operation, ...checkResult(result, operation), wallMs: performance.now() - started,
      operationProcessOpenCalls: difference(counted.snapshot(), before.processes),
      operationSessionRequests: difference(counted.sessionOperations(), before.requests),
    };
  } finally {
    await cas.close();
  }
  assert.equal(counted.activeSessions().size, 0);
  return {
    ...measured,
    totalProcessOpenCalls: Object.fromEntries(counted.snapshot()),
    totalSessionRequests: Object.fromEntries(counted.sessionOperations()),
    workerPeakRssBytes: process.resourceUsage().maxRSS * 1024,
    pageBytes: PAGE_BYTES,
  };
}

async function execute(namespace, operation) {
  const oldest = identity('record-0');
  const attempt = identity('measured-attempt');
  const commands = {
    'inspect-oldest': () => namespace.inspect(oldest),
    'read-original': () => namespace.readEvidence({ ...oldest, stage: 'preparation' }),
    'filtered-list': () => namespace.list({ phase: 'reserved', limit: 1, nodeBudget: 129 }),
    reserve: () => namespace.reserve(attempt),
    prepare: () => namespace.prepare({ ...attempt, evidence: { record: page(999, 1) } }),
    arm: () => namespace.arm(attempt),
    'retry-arm': () => namespace.arm(attempt),
    settle: () => namespace.settle({ ...attempt, evidence: { record: page(999, 2) } }),
    'capacity-refusal': () => namespace.reserve(identity('one-too-many')),
    'read-final-after-gc': () => namespace.readEvidence({ ...oldest, stage: 'settlement' }),
  };
  return await commands[operation]();
}

function checkResult(result, operation) {
  const statuses = {
    'inspect-oldest': 'inspected', 'read-original': 'read', 'filtered-list': 'page',
    reserve: 'admitted', prepare: 'prepared', arm: 'armed', 'retry-arm': 'refused',
    settle: 'settled', 'capacity-refusal': 'refused', 'read-final-after-gc': 'read',
  };
  assert.equal(result.status, statuses[operation]);
  if (operation === 'retry-arm') {
    assert.equal(result.reason, 'already-armed');
  }
  if (operation === 'capacity-refusal') {
    assert.equal(result.reason, 'capacity-full');
  }
  if (result.status === 'read') {
    assert.deepEqual(result.evidence.record, page(0, operation === 'read-original' ? 1 : 2));
  }
  if (result.status === 'page') {
    assert.equal(result.records.length, 0);
    assert(result.visitedNodes <= 129);
    return { status: result.status, visitedNodes: result.visitedNodes, hasContinuation: result.next !== null };
  }
  return { status: result.status, reason: result.reason ?? null };
}

function difference(after, before) {
  return Object.fromEntries([...after].flatMap(([key, value]) => {
    const count = value - (before.get(key) ?? 0);
    return count === 0 ? [] : [[key, count]];
  }));
}
