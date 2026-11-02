import { describe, expect, it, vi } from 'vitest';
import { reservationLedgerFixture as fixture } from '../../../helpers/reservation-ledger.js';
import ReservationEvidence from '../../../../src/domain/value-objects/ReservationEvidence.js';
import { utf8Encode, utf8Decode } from '../../../../src/domain/encoding/utf8.js';
import { CasError, ErrorCodes } from '../../../../src/domain/errors/index.js';

const ATTEMPT = { key: 'first', binding: 'a'.repeat(64) };
const NAMESPACE = 'test/admission';
const CUSTODY_PREFIX = 'refs/cas/reservation-custody/';
const evidence = (text = 'original') => new ReservationEvidence({ record: utf8Encode(text) });

async function prepared() {
  const context = fixture();
  const ledger = context.open();
  expect((await ledger.reserve(ATTEMPT)).status).toBe('admitted');
  const result = await ledger.prepare({ ...ATTEMPT, evidence: evidence() });
  expect(result.status).toBe('prepared');
  return { ...context, ledger, record: result.record };
}

async function charged(store) {
  return (await store.read(NAMESPACE)).header.charged;
}

async function custodyRefs(refs) {
  const found = [];
  for await (const ref of refs.iterateRefs({ prefix: CUSTODY_PREFIX, limit: 10 })) {
    found.push(ref);
  }
  return found;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function forceWinner(context, winner, operations) {
  const both = deferred();
  const won = deferred();
  const original = context.refs.updateRef.bind(context.refs);
  let arrivals = 0;
  vi.spyOn(context.refs, 'updateRef').mockImplementation(async (options) => {
    if (!options.ref.startsWith('refs/cas/reservations/')) {
      return await original(options);
    }
    const root = await context.refs.resolveTree(options.newOid);
    const entries = await context.persistence.readTree(root);
    const next = await context.index.get(entries.find((entry) => entry.name === 'records').oid, ATTEMPT.key);
    arrivals++;
    if (arrivals === 2) {
      both.resolve();
    }
    await both.promise;
    if (next.phase === winner) {
      const installed = await original(options);
      won.resolve();
      return installed;
    }
    await won.promise;
    return await original(options);
  });
  return await Promise.all(operations.map((operation) => operation()));
}

describe('Reservation custody lifetime', () => {
  it('retains original and final records while charging only one slot', async () => {
    const { ledger, record, custody, objects, persistence, refs, store } = await prepared();
    expect((await ledger.arm(ATTEMPT)).status).toBe('armed');
    const settled = await ledger.settle({ ...ATTEMPT, evidence: evidence('final') });
    expect(settled.status).toBe('settled');
    const current = await custody.verify(settled.record);
    expect(await refs.resolveParents(current.revision)).toContain(record.preparation);
    const original = await objects.read(record.preparation);
    expect(utf8Decode(await persistence.readBlob(original.descriptor.recordOid))).toBe('original');
    expect(utf8Decode(await persistence.readBlob(current.descriptor.recordOid))).toBe('final');
    expect(await charged(store)).toBe(1);
    const remove = vi.spyOn(refs, 'deleteRef');
    expect(await ledger.cancel(ATTEMPT)).toMatchObject({ status: 'refused', reason: 'irreversible' });
    expect(remove).not.toHaveBeenCalled();
  });

  it('settles a prepared read without granting an external-effect permission', async () => {
    const { ledger } = await prepared();
    expect((await ledger.settle({ ...ATTEMPT, evidence: evidence('answer') })).status).toBe('settled');
    expect(await ledger.arm(ATTEMPT)).toMatchObject({ status: 'refused', reason: 'already-settled' });
  });

  it('cancels prepared custody before making its slot reusable', async () => {
    const { ledger, refs, store } = await prepared();
    expect((await ledger.cancel(ATTEMPT)).status).toBe('cancelled');
    expect(await charged(store)).toBe(0);
    expect(await custodyRefs(refs)).toEqual([]);
    expect((await ledger.cancel(ATTEMPT)).status).toBe('cancelled');
    expect(await ledger.reserve(ATTEMPT)).toMatchObject({ status: 'refused', reason: 'cancelled' });
    expect((await ledger.reserve({ ...ATTEMPT, key: 'second' })).status).toBe('admitted');
  });
});

describe('Exact custody identity and arming permission', () => {
  it('recovers exact preparation but rejects replacement evidence', async () => {
    const { ledger, record, custody } = await prepared();
    expect(await ledger.prepare({ ...ATTEMPT, evidence: evidence() })).toMatchObject({ status: 'recovered', record });
    expect(await ledger.prepare({ ...ATTEMPT, evidence: evidence('changed') })).toMatchObject({ status: 'refused', reason: 'preparation-mismatch' });
    expect((await custody.verify(record)).revision).toBe(record.preparation);
  });

  it('recovers exact settlement but never replaces the final record', async () => {
    const { ledger, custody } = await prepared();
    const settled = await ledger.settle({ ...ATTEMPT, evidence: evidence('final') });
    expect(await ledger.settle({ ...ATTEMPT, evidence: evidence('final') })).toMatchObject({ status: 'recovered', record: settled.record });
    expect(await ledger.settle({ ...ATTEMPT, evidence: evidence('replacement') })).toMatchObject({ status: 'refused', reason: 'settlement-mismatch' });
    expect((await custody.verify(settled.record)).revision).toBe(settled.record.settlement);
  });

  it('issues fresh arming only once and never through inspection or reserve retry', async () => {
    const { ledger, open } = await prepared();
    expect((await ledger.arm(ATTEMPT)).status).toBe('armed');
    expect(await open().arm(ATTEMPT)).toMatchObject({ status: 'refused', reason: 'already-armed' });
    expect(await open().inspect(ATTEMPT)).toMatchObject({ status: 'recovered', record: { phase: 'armed' } });
    expect(await open().reserve(ATTEMPT)).toMatchObject({ status: 'recovered', record: { phase: 'armed' } });
  });
});

describe('Concurrent settlement identity', () => {
  it('recovers identical final evidence without a second generation', async () => {
    const { ledger, custody, store } = await prepared();
    const results = await Promise.all([
      ledger.settle({ ...ATTEMPT, evidence: evidence('same final') }),
      ledger.settle({ ...ATTEMPT, evidence: evidence('same final') }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['recovered', 'settled']);
    expect(results[0].record.settlement).toBe(results[1].record.settlement);
    expect((await custody.verify(results[0].record)).revision).toBe(results[0].record.settlement);
    expect(await charged(store)).toBe(1);
  });

  it('refuses one of two conflicting final descriptors without replacing the winner', async () => {
    const { ledger, custody, store } = await prepared();
    const results = await Promise.all([
      ledger.settle({ ...ATTEMPT, evidence: evidence('first final') }),
      ledger.settle({ ...ATTEMPT, evidence: evidence('second final') }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['refused', 'settled']);
    expect(results.find((result) => result.status === 'refused').reason).toBe('settlement-mismatch');
    const winner = results.find((result) => result.status === 'settled');
    expect((await custody.verify(winner.record)).revision).toBe(winner.record.settlement);
    expect(await charged(store)).toBe(1);
  });
});

describe('Missing evidence is not a refund', () => {
  it('refuses arm, cancel, settle and recovery after the prepared pin disappears', async () => {
    const { ledger, refs, store } = await prepared();
    const [pin] = await custodyRefs(refs);
    await refs.deleteRef({ ref: pin.ref, expectedOldOid: pin.oid });
    const before = await store.read(NAMESPACE);
    for (const operation of [() => ledger.arm(ATTEMPT), () => ledger.cancel(ATTEMPT),
      () => ledger.settle({ ...ATTEMPT, evidence: evidence('final') }), () => ledger.reserve(ATTEMPT)]) {
      const result = await operation();
      expect(result.status).toBe('indeterminate');
      expect((result.cause.meta?.operationError ?? result.cause).code).toBe('RESERVATION_CORRUPT');
    }
    expect((await store.read(NAMESPACE)).revision).toBe(before.revision);
    expect(await charged(store)).toBe(1);
    expect(await custodyRefs(refs)).toEqual([]);
  });

  it('does not pin evidence for an unreserved or conflicting attempt', async () => {
    const { open, refs } = fixture();
    expect(await open().prepare({ ...ATTEMPT, evidence: evidence() })).toMatchObject({ status: 'refused', reason: 'not-reserved' });
    await open().reserve(ATTEMPT);
    expect(await open().prepare({ ...ATTEMPT, binding: 'b'.repeat(64), evidence: evidence() })).toMatchObject({ status: 'refused', reason: 'binding-conflict' });
    expect(await custodyRefs(refs)).toEqual([]);
  });
});

describe('Arm and cancel share one winning ledger transition', () => {
  it.each(['armed', 'cancelled'])('honors the %s winner', async (winner) => {
    const context = await prepared();
    const results = await forceWinner(context, winner, [() => context.ledger.arm(ATTEMPT), () => context.ledger.cancel(ATTEMPT)]);
    expect(results.filter((result) => result.status === winner)).toHaveLength(1);
    const loser = results.find((result) => result.status === 'refused');
    expect(loser.reason).toBe(winner === 'armed' ? 'irreversible' : 'cancelled');
    expect(await charged(context.store)).toBe(winner === 'armed' ? 1 : 0);
    expect((await custodyRefs(context.refs)).length).toBe(winner === 'armed' ? 1 : 0);
  });

  it.each(['settled', 'cancelled'])('honors the %s winner against read settlement', async (winner) => {
    const context = await prepared();
    const results = await forceWinner(context, winner, [
      () => context.ledger.settle({ ...ATTEMPT, evidence: evidence('final') }), () => context.ledger.cancel(ATTEMPT),
    ]);
    expect(results.filter((result) => result.status === winner)).toHaveLength(1);
    expect(results.find((result) => result.status === 'refused').reason).toBe(winner === 'settled' ? 'irreversible' : 'cancelled');
    expect(await charged(context.store)).toBe(winner === 'settled' ? 1 : 0);
    expect((await custodyRefs(context.refs)).length).toBe(winner === 'settled' ? 1 : 0);
  });
});

describe('A late pin cannot resurrect a cancelled attempt', () => {
  it('cleans a preparation pin that arrives after cancellation already returned', async () => {
    const { open, refs, store } = fixture();
    const ledger = open();
    await ledger.reserve(ATTEMPT);
    const entered = deferred();
    const release = deferred();
    const original = refs.updateRef.bind(refs);
    vi.spyOn(refs, 'updateRef').mockImplementation(async (options) => {
      if (options.ref.startsWith(CUSTODY_PREFIX)) {
        entered.resolve();
        await release.promise;
      }
      return await original(options);
    });
    const pending = ledger.prepare({ ...ATTEMPT, evidence: evidence() });
    await entered.promise;
    expect((await ledger.cancel(ATTEMPT)).status).toBe('cancelled');
    release.resolve();
    expect(await pending).toMatchObject({ status: 'refused', reason: 'cancelled' });
    expect(await custodyRefs(refs)).toEqual([]);
    expect(await charged(store)).toBe(0);
    expect(await ledger.arm(ATTEMPT)).toMatchObject({ status: 'refused', reason: 'cancelled' });
  });
});

describe('Lost custody acknowledgements', () => {
  it('reconciles a pin installed before its response was lost', async () => {
    const { open, refs } = fixture();
    const ledger = open();
    await ledger.reserve(ATTEMPT);
    const original = refs.updateRef.bind(refs);
    vi.spyOn(refs, 'updateRef').mockImplementationOnce(async (options) => {
      await original(options);
      throw new CasError('Pin acknowledgement lost', ErrorCodes.GIT_ERROR);
    });
    expect((await ledger.prepare({ ...ATTEMPT, evidence: evidence() })).status).toBe('prepared');
    expect((await custodyRefs(refs)).length).toBe(1);
  });

  it('never issues fresh permission after an arming acknowledgement was lost', async () => {
    const { ledger, store, refs } = await prepared();
    const original = refs.updateRef.bind(refs);
    vi.spyOn(refs, 'updateRef').mockImplementationOnce(async (options) => {
      await original(options);
      throw new CasError('Arming acknowledgement lost', ErrorCodes.GIT_ERROR);
    });
    expect(await ledger.arm(ATTEMPT)).toMatchObject({ status: 'refused', reason: 'already-armed' });
    expect(await ledger.inspect(ATTEMPT)).toMatchObject({ status: 'recovered', record: { phase: 'armed' } });
    expect(await ledger.cancel(ATTEMPT)).toMatchObject({ status: 'refused', reason: 'irreversible' });
    expect(await charged(store)).toBe(1);
  });
});

describe('Cancelled residue reconciliation', () => {
  it('retains a cancelled ledger result when deletion is unavailable, then cleans on retry', async () => {
    const { ledger, refs, store } = await prepared();
    const remove = vi.spyOn(refs, 'deleteRef').mockRejectedValue(new CasError('Deletion unavailable', ErrorCodes.GIT_ERROR));
    expect((await ledger.cancel(ATTEMPT)).status).toBe('indeterminate');
    expect(await charged(store)).toBe(0);
    expect((await custodyRefs(refs)).length).toBe(1);
    expect(await ledger.inspect(ATTEMPT)).toMatchObject({ status: 'recovered', record: { phase: 'cancelled' } });
    remove.mockRestore();
    expect((await ledger.cancel(ATTEMPT)).status).toBe('cancelled');
    expect(await custodyRefs(refs)).toEqual([]);
    expect(await charged(store)).toBe(0);
  });

  it('recovers an acknowledged-then-lost deletion without another refund', async () => {
    const { ledger, refs, store } = await prepared();
    const original = refs.deleteRef.bind(refs);
    vi.spyOn(refs, 'deleteRef').mockImplementationOnce(async (options) => {
      await original(options);
      throw new CasError('Delete acknowledgement lost', ErrorCodes.GIT_ERROR);
    });
    expect((await ledger.cancel(ATTEMPT)).status).toBe('cancelled');
    expect(await charged(store)).toBe(0);
    expect(await custodyRefs(refs)).toEqual([]);
  });
});
