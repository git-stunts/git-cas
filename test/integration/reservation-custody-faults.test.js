import { afterEach, describe, expect, it, vi } from 'vitest';
import NativeReservationHarness from '../helpers/NativeReservationHarness.js';
import ReservationEvidence from '../../src/domain/value-objects/ReservationEvidence.js';
import { utf8Encode } from '../../src/domain/encoding/utf8.js';

if (process.env.GIT_STUNTS_DOCKER !== '1') {
  throw new Error('Reservation fault integration must run in Docker');
}

vi.setConfig({ testTimeout: 90_000, hookTimeout: 30_000 });
const harness = new NativeReservationHarness();
const ATTEMPT = { key: 'same', binding: 'a'.repeat(64) };
const LEDGER = 'refs/cas/reservations/';
const CUSTODY = 'refs/cas/reservation-custody/';
const page = (text) => new ReservationEvidence({ record: utf8Encode(text) });
afterEach(async () => await harness.destroy());

const POINTS = [
  { point: 'charge', operation: 'reserve', method: 'updateRef', prefix: LEDGER, before: null, after: 'reserved' },
  { point: 'preparation pin', operation: 'prepare', method: 'updateRef', prefix: CUSTODY, before: 'reserved', after: 'prepared' },
  { point: 'preparation ledger', operation: 'prepare', method: 'updateRef', prefix: LEDGER, before: 'reserved', after: 'prepared' },
  { point: 'arm', operation: 'arm', method: 'updateRef', prefix: LEDGER, before: 'prepared', after: 'armed' },
  { point: 'final pin', operation: 'settle', method: 'updateRef', prefix: CUSTODY, before: 'prepared', after: 'settled' },
  { point: 'settlement ledger', operation: 'settle', method: 'updateRef', prefix: LEDGER, before: 'prepared', after: 'settled' },
  { point: 'cancellation ledger', operation: 'cancel', method: 'updateRef', prefix: LEDGER, before: 'prepared', after: 'cancelled' },
  { point: 'cancelled pin deletion', operation: 'cancel', method: 'deleteRef', prefix: CUSTODY, before: 'cancelled', after: 'cancelled' },
];
const CASES = POINTS.flatMap((point) => ['before', 'after'].map((when) => ({ ...point, when })));

async function setup(format, operation) {
  const repo = harness.repository(format);
  const context = await harness.open(repo);
  if (operation !== 'reserve') {
    await context.ledger.reserve(ATTEMPT);
  }
  if (['arm', 'settle', 'cancel'].includes(operation)) {
    expect((await context.ledger.prepare({ ...ATTEMPT, evidence: page('original') })).status).toBe('prepared');
  }
  return { ...context, repo };
}

async function perform(ledger, operation) {
  if (operation === 'prepare' || operation === 'settle') {
    return await ledger[operation]({ ...ATTEMPT, evidence: page(operation === 'prepare' ? 'original' : 'final') });
  }
  return await ledger[operation](ATTEMPT);
}

async function assertState(context, phase) {
  const inspection = await context.ledger.inspect(ATTEMPT);
  if (phase === null) {
    expect(inspection).toMatchObject({ status: 'refused', reason: 'not-reserved' });
    expect(await context.store.read('test/admission')).toBeNull();
    return;
  }
  expect(inspection).toMatchObject({ status: 'recovered', record: { phase } });
  expect((await context.store.read('test/admission')).header.charged).toBe(phase === 'cancelled' ? 0 : 1);
  if (['prepared', 'armed', 'settled'].includes(phase)) {
    expect(await context.custody.verify(inspection.record)).not.toBeNull();
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

describe.each(['sha1', 'sha256'])('native %s durable-write failure matrix', (format) => {
  it.each(CASES)('$when $point preserves state and exact recovery', async (sample) => {
    const context = await setup(format, sample.operation);
    context.refs.fail(sample);
    const result = await perform(context.ledger, sample.operation);
    expect(context.refs.faultCount).toBeGreaterThan(0);
    assertOutcome(result, sample);
    const phase = sample[sample.when];
    context.refs.clearFault();
    await assertState(context, phase);
    await harness.closeAdapters();
    harness.git(context.repo, ['gc', '--prune=now']);
    const reopened = await harness.open(context.repo);
    await assertState(reopened, phase);
    const retried = await perform(reopened.ledger, sample.operation);
    if (sample.operation === 'arm' && sample.when === 'after') {
      expect(retried).toMatchObject({ status: 'refused', reason: 'already-armed' });
    } else {
      expect(['admitted', 'prepared', 'armed', 'settled', 'cancelled', 'recovered']).toContain(retried.status);
    }
    await assertState(reopened, sample.after);
  });
});
