import { afterEach, describe, expect, it, vi } from 'vitest';
import NativeReservationHarness from '../helpers/NativeReservationHarness.js';
import { runPublicReservationProcesses } from '../helpers/reservation-ledger-processes.js';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 30_000 });
const harness = new NativeReservationHarness();
const ATTEMPT = { key: 'same', binding: 'a'.repeat(64) };
const ORIGINAL = new Uint8Array([1, 2, 3]);
afterEach(async () => { await harness.destroy(); });

async function setup(format, { prepared = false } = {}) {
  const repo = harness.repository(format);
  const { namespace } = await harness.openPublic(repo);
  if (prepared) {
    await namespace.reserve(ATTEMPT);
    expect((await namespace.prepare({ ...ATTEMPT, evidence: { record: ORIGINAL } })).status).toBe('prepared');
  }
  await harness.closeAdapters();
  return repo;
}

async function reopen(repo) {
  await harness.closeAdapters();
  harness.git(repo, ['gc', '--prune=now']);
  return (await harness.openPublic(repo)).namespace;
}

describe.each(['sha1', 'sha256'])('public %s independent admission', (format) => {
  it('admits at most one distinct key at capacity one', async () => {
    const repo = await setup(format);
    const { observed, results } = await runPublicReservationProcesses(repo, ['first', 'second']);
    expect(observed[0]).toBe(observed[1]);
    expect(observed[0]).not.toBeNull();
    expect(results.map((result) => result.status).sort()).toEqual(['admitted', 'refused']);
    const winner = results.find((result) => result.status === 'admitted');
    expect(results.find((result) => result.status === 'refused').reason).toBe('capacity-full');
    const namespace = await reopen(repo);
    expect(await namespace.list()).toMatchObject({ status: 'page', charged: 1 });
    expect(await namespace.reserve({ ...ATTEMPT, key: winner.key })).toMatchObject({ status: 'recovered', revision: winner.revision });
    expect(await namespace.reserve({ ...ATTEMPT, key: 'third' })).toMatchObject({ status: 'refused', reason: 'capacity-full' });
  });

  it('charges exact retries once and refuses conflicting bindings before and after restart', async () => {
    const repo = await setup(format);
    const { observed, results } = await runPublicReservationProcesses(repo, ['same', 'same']);
    expect(observed[0]).toBe(observed[1]);
    expect(results.map((result) => result.status).sort()).toEqual(['admitted', 'recovered']);
    const namespace = (await harness.openPublic(repo)).namespace;
    const conflicting = { ...ATTEMPT, binding: 'b'.repeat(64) };
    expect(await namespace.reserve(conflicting)).toMatchObject({ status: 'refused', reason: 'binding-conflict' });
    const restarted = await reopen(repo);
    expect(await restarted.reserve(conflicting)).toMatchObject({ status: 'refused', reason: 'binding-conflict' });
    expect(await restarted.list()).toMatchObject({ status: 'page', charged: 1 });
  });

  it('recovers a lost admission response in another process without a second charge', async () => {
    const repo = await setup(format);
    const first = await runPublicReservationProcesses(repo, ['same'], { fault: 'lost-ack' });
    expect(first.results[0]).toMatchObject({ status: 'recovered', phase: 'reserved' });
    harness.git(repo, ['gc', '--prune=now']);
    const second = await runPublicReservationProcesses(repo, ['same']);
    expect(second.results[0]).toMatchObject({ status: 'recovered', revision: first.results[0].revision });
    expect(await (await reopen(repo)).list()).toMatchObject({ status: 'page', charged: 1 });
  });
});

describe.each(['sha1', 'sha256'])('public %s independent permission', (format) => {
  it('grants only one fresh arm acknowledgement from a shared prepared snapshot', async () => {
    const repo = await setup(format, { prepared: true });
    const { observed, results } = await runPublicReservationProcesses(repo, ['same', 'same'], { operations: ['arm', 'arm'] });
    expect(observed[0]).toBe(observed[1]);
    expect(results.map((result) => result.status).sort()).toEqual(['armed', 'refused']);
    expect(results.find((result) => result.status === 'refused').reason).toBe('already-armed');
    const namespace = await reopen(repo);
    expect(await namespace.inspect(ATTEMPT)).toMatchObject({ status: 'inspected', record: { phase: 'armed' } });
    expect(await namespace.reconcile(ATTEMPT)).toMatchObject({ status: 'recovered' });
    expect(await namespace.arm(ATTEMPT)).toMatchObject({ status: 'refused', reason: 'already-armed' });
  });

  it.each(['before', 'after'])('preserves honest arming after process-group death %s its CAS', async (when) => {
    const repo = await setup(format, { prepared: true });
    const { results } = await runPublicReservationProcesses(repo, ['same'], { operations: ['arm'], fault: `crash-${when}` });
    expect(results).toEqual([{ status: 'terminated', boundary: `${when} ledger CAS` }]);
    const namespace = await reopen(repo);
    expect(await namespace.inspect(ATTEMPT)).toMatchObject({ status: 'inspected', record: { phase: when === 'before' ? 'prepared' : 'armed' } });
    expect(await namespace.list()).toMatchObject({ status: 'page', charged: 1 });
    expect((await namespace.readEvidence({ ...ATTEMPT, stage: 'preparation' })).evidence.record).toEqual(ORIGINAL);
    expect((await namespace.reconcile(ATTEMPT)).status).toBe('recovered');
    const retry = await namespace.arm(ATTEMPT);
    expect(retry.status).toBe(when === 'before' ? 'armed' : 'refused');
    expect(await namespace.cancel(ATTEMPT)).toMatchObject({ status: 'refused', reason: 'irreversible' });
  });
});

const ORDERED = ['arm', 'settle'].flatMap((operation) => [0, 1].map((first) => ({ operation, first })));
describe.each(['sha1', 'sha256'])('public %s cancellation races', (format) => {
  it.each(ORDERED)('$operation versus cancel with process $first released first', async ({ operation, first }) => {
    const repo = await setup(format, { prepared: true });
    const { observed, results } = await runPublicReservationProcesses(repo, ['same', 'same'], { operations: [operation, 'cancel'], first });
    expect(observed[0]).toBe(observed[1]);
    const winner = first === 0 ? (operation === 'arm' ? 'armed' : 'settled') : 'cancelled';
    expect(results[first].status).toBe(winner);
    expect(results[1 - first]).toMatchObject({ status: 'refused', reason: winner === 'cancelled' ? 'cancelled' : 'irreversible' });
    const namespace = await reopen(repo);
    expect(await namespace.inspect(ATTEMPT)).toMatchObject({ status: 'inspected', record: { phase: winner } });
    expect(await namespace.list()).toMatchObject({ status: 'page', charged: winner === 'cancelled' ? 0 : 1 });
  });

  it('refuses a late preparation after cancellation refunds and a replacement consumes the slot', async () => {
    const repo = await setup(format);
    const namespace = (await harness.openPublic(repo)).namespace;
    await namespace.reserve(ATTEMPT);
    await harness.closeAdapters();
    const { observed, results } = await runPublicReservationProcesses(repo, ['same', 'same'], {
      operations: ['prepare', 'cancel'], first: 1,
      afterFirst: async () => {
        const replacement = (await harness.openPublic(repo)).namespace;
        expect(await replacement.reserve({ ...ATTEMPT, key: 'replacement' })).toMatchObject({ status: 'admitted' });
        await harness.closeAdapters();
      },
    });
    expect(observed[0]).toBe(observed[1]);
    expect(results[1].status).toBe('cancelled');
    expect(results[0]).toMatchObject({ status: 'refused', reason: 'cancelled' });
    const restarted = await reopen(repo);
    expect(await restarted.inspect(ATTEMPT)).toMatchObject({ status: 'inspected', custody: null, record: { phase: 'cancelled' } });
    expect(await restarted.list()).toMatchObject({ status: 'page', charged: 1 });
    expect(await restarted.arm(ATTEMPT)).toMatchObject({ status: 'refused', reason: 'cancelled' });
    expect(await restarted.reserve({ ...ATTEMPT, key: 'replacement' })).toMatchObject({ status: 'recovered' });
  });
});
