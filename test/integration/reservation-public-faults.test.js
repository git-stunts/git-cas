import { afterEach, describe, expect, it, vi } from 'vitest';
import NativeReservationHarness from '../helpers/NativeReservationHarness.js';
import NativeReservationPublicFault from '../helpers/NativeReservationPublicFault.js';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 30_000 });
const harness = new NativeReservationHarness();
const ATTEMPT = { key: 'current', binding: 'a'.repeat(64) };
const EARLIER = { key: 'earlier', binding: 'b'.repeat(64) };
const ORIGINAL = new Uint8Array([1, 2, 3]);
const FINAL = new Uint8Array([4, 5, 6]);
const LEDGER = 'refs/cas/reservations/';
const CUSTODY = 'refs/cas/reservation-custody/';
const POINTS = [
  { point: 'charge', operation: 'reserve', method: 'updateRef', prefix: LEDGER, before: null, after: 'reserved' },
  { point: 'original pin', operation: 'prepare', method: 'updateRef', prefix: CUSTODY, before: 'reserved', after: 'prepared' },
  { point: 'preparation ledger', operation: 'prepare', method: 'updateRef', prefix: LEDGER, before: 'reserved', after: 'prepared' },
  { point: 'arm', operation: 'arm', method: 'updateRef', prefix: LEDGER, before: 'prepared', after: 'armed' },
  { point: 'final pin', operation: 'settle', method: 'updateRef', prefix: CUSTODY, before: 'armed', after: 'settled' },
  { point: 'settlement ledger', operation: 'settle', method: 'updateRef', prefix: LEDGER, before: 'armed', after: 'settled' },
  { point: 'cancellation ledger', operation: 'cancel', method: 'updateRef', prefix: LEDGER, before: 'prepared', after: 'cancelled' },
  { point: 'cancelled pin deletion', operation: 'cancel', method: 'deleteRef', prefix: CUSTODY, before: 'cancelled', after: 'cancelled' },
];
const CASES = POINTS.flatMap((point) => ['before', 'after'].map((when) => ({ ...point, when })));

afterEach(async () => {
  vi.restoreAllMocks();
  await harness.destroy();
});

function recordFields(record) {
  return { key: record.key, binding: record.binding, phase: record.phase,
    preparation: record.preparation, settlement: record.settlement };
}

async function earlierReceipt(namespace, repo) {
  const blob = harness.git(repo, ['hash-object', '-w', '--stdin'], 'earlier basis');
  const tree = harness.git(repo, ['mktree'], `100644 blob ${blob}\tbasis\n`);
  const parent = harness.git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit-tree', tree], 'earlier history');
  await namespace.reserve(EARLIER);
  await namespace.prepare({ ...EARLIER, evidence: { record: ORIGINAL, supports: [{ type: 'tree', oid: tree }], parents: [parent] } });
  expect((await namespace.arm(EARLIER)).status).toBe('armed');
  const receipt = await namespace.settle({ ...EARLIER, evidence: { record: FINAL } });
  expect(receipt.status).toBe('settled');
  return { receipt, record: recordFields(receipt.record), blob, tree, parent };
}

async function setup(format, operation) {
  const repo = harness.repository(format);
  const { namespace } = await harness.openPublic(repo, 2);
  const earlier = await earlierReceipt(namespace, repo);
  if (operation !== 'reserve') {
    expect((await namespace.reserve(ATTEMPT)).status).toBe('admitted');
  }
  if (['arm', 'settle', 'cancel'].includes(operation)) {
    expect((await namespace.prepare({ ...ATTEMPT, evidence: { record: ORIGINAL } })).status).toBe('prepared');
  }
  if (operation === 'settle') {
    expect((await namespace.arm(ATTEMPT)).status).toBe('armed');
  }
  return { namespace, repo, earlier };
}

async function perform(namespace, operation) {
  if (operation === 'prepare' || operation === 'settle') {
    return await namespace[operation]({ ...ATTEMPT, evidence: { record: operation === 'prepare' ? ORIGINAL : FINAL } });
  }
  return await namespace[operation](ATTEMPT);
}

async function assertEarlier(namespace, repo, earlier) {
  expect(recordFields(earlier.receipt.record)).toEqual(earlier.record);
  const inspection = await namespace.inspect(EARLIER);
  expect(inspection.status).toBe('inspected');
  expect(recordFields(inspection.record)).toEqual(earlier.record);
  expect((await namespace.readEvidence({ ...EARLIER, stage: 'preparation' })).evidence.record).toEqual(ORIGINAL);
  expect((await namespace.readEvidence({ ...EARLIER, stage: 'settlement' })).evidence.record).toEqual(FINAL);
  expect(harness.git(repo, ['cat-file', '-p', earlier.blob])).toBe('earlier basis');
  expect(harness.git(repo, ['cat-file', '-t', earlier.tree])).toBe('tree');
  expect(harness.git(repo, ['cat-file', '-t', earlier.parent])).toBe('commit');
}

async function assertCurrent(namespace, phase) {
  const inspection = await namespace.inspect(ATTEMPT);
  const page = await namespace.list();
  expect(page.status).toBe('page');
  expect(page.charged).toBe(phase === null || phase === 'cancelled' ? 1 : 2);
  expect(page.records.filter((record) => record.key === ATTEMPT.key)).toHaveLength(phase === null ? 0 : 1);
  if (phase === null) {
    expect(inspection).toMatchObject({ status: 'refused', reason: 'not-reserved' });
    return;
  }
  expect(inspection).toMatchObject({ status: 'inspected', record: { ...ATTEMPT, phase } });
  if (['prepared', 'armed', 'settled'].includes(phase)) {
    expect(inspection.custody).not.toBeNull();
    expect((await namespace.readEvidence({ ...ATTEMPT, stage: 'preparation' })).evidence.record).toEqual(ORIGINAL);
  }
  if (phase === 'settled') {
    expect((await namespace.readEvidence({ ...ATTEMPT, stage: 'settlement' })).evidence.record).toEqual(FINAL);
  }
  if (phase === 'armed' || phase === 'settled') {
    expect(await namespace.cancel(ATTEMPT)).toMatchObject({ status: 'refused', reason: 'irreversible' });
    expect(await namespace.reserve({ key: 'overflow', binding: ATTEMPT.binding })).toMatchObject({ status: 'refused', reason: 'capacity-full' });
  }
}

function assertOutcome(result, sample) {
  if (sample.when === 'before') {
    expect(result.status).toBe('indeterminate');
  } else if (sample.operation === 'arm') {
    expect(result).toMatchObject({ status: 'refused', reason: 'already-armed' });
  } else {
    expect(['admitted', 'prepared', 'settled', 'cancelled', 'recovered']).toContain(result.status);
  }
}

async function recover(context, sample, result) {
  await harness.closeAdapters();
  harness.git(context.repo, ['gc', '--prune=now']);
  const { namespace } = await harness.openPublic(context.repo, 2);
  await assertCurrent(namespace, sample[sample.when]);
  await assertEarlier(namespace, context.repo, context.earlier);
  const repaired = await namespace.reconcile(ATTEMPT);
  expect(repaired.status).not.toBe('armed');
  const retried = await perform(namespace, sample.operation);
  if (sample.operation === 'arm' && sample.when === 'after') {
    expect(retried).toMatchObject({ status: 'refused', reason: 'already-armed' });
  } else {
    expect(['admitted', 'prepared', 'armed', 'settled', 'cancelled', 'recovered']).toContain(retried.status);
  }
  expect([result, repaired, retried].filter((outcome) => outcome.status === 'armed'))
    .toHaveLength(sample.operation === 'arm' && sample.when === 'before' ? 1 : 0);
  await assertCurrent(namespace, sample.after);
  await assertEarlier(namespace, context.repo, context.earlier);
  await harness.closeAdapters();
  harness.git(context.repo, ['gc', '--prune=now']);
  const reopened = (await harness.openPublic(context.repo, 2)).namespace;
  await assertCurrent(reopened, sample.after);
  await assertEarlier(reopened, context.repo, context.earlier);
}

describe.each(['sha1', 'sha256'])('public %s durable-boundary failure matrix', (format) => {
  it.each(CASES)('$when $point preserves earlier receipts, charge and exact recovery', async (sample) => {
    const context = await setup(format, sample.operation);
    const fault = new NativeReservationPublicFault(sample);
    const result = await perform(context.namespace, sample.operation);
    expect(fault.count).toBeGreaterThan(0);
    assertOutcome(result, sample);
    fault.restore();
    await assertCurrent(context.namespace, sample[sample.when]);
    await assertEarlier(context.namespace, context.repo, context.earlier);
    await recover(context, sample, result);
  });
});
