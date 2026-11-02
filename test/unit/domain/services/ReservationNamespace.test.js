import { describe, expect, it, vi } from 'vitest';
import ReservationNamespace from '../../../../src/domain/services/ReservationNamespace.js';
import ReservationEvidence from '../../../../src/domain/value-objects/ReservationEvidence.js';
import { CasError, ErrorCodes } from '../../../../src/domain/errors/index.js';
import { reservationNamespaceFixture, RESERVATION_TEST_BINDING as binding, RESERVATION_TEST_NAMESPACE as namespace } from '../../../helpers/reservation-namespace.js';

const identity = { key: 'attempt', binding };
const original = { record: new Uint8Array([1, 2, 3]) };
const final = { record: new Uint8Array([4, 5, 6]) };

describe('durable reservation namespace', () => {
  it('persists policy and an empty index on open, before admission', async () => {
    const f = reservationNamespaceFixture();
    const opened = await f.open(3);
    expect(opened).toBeInstanceOf(ReservationNamespace);
    expect(Object.isFrozen(opened)).toBe(true);
    expect((await f.store.read(namespace)).header.charged).toBe(0);
    expect(await opened.list()).toMatchObject({ status: 'page', charged: 0, records: [], next: null, visitedNodes: 1 });
    expect(await f.open(4)).toMatchObject({ status: 'refused', reason: 'policy-mismatch' });
    expect((await f.open(3)).openedRevision).toBe(opened.openedRevision);
  });

  it('makes competing policies choose one durable authority', async () => {
    const f = reservationNamespaceFixture();
    const results = await Promise.all([f.open(1), f.open(2)]);
    expect(results.map((x) => x.status).sort()).toEqual(['opened', 'refused']);
    const winner = results.find((x) => x.status === 'opened');
    expect((await f.store.read(namespace)).header.policy.limit).toBe(winner.policy.limit);
  });

  it('recovers a lost open acknowledgement without replacing policy', async () => {
    const f = reservationNamespaceFixture();
    const update = f.refs.updateRef.bind(f.refs);
    vi.spyOn(f.refs, 'updateRef').mockImplementationOnce(async (options) => {
      await update(options);
      throw new Error('lost acknowledgement');
    });
    expect(await f.open(2)).toMatchObject({ status: 'opened', policy: { limit: 2 } });
    expect(await f.open(3)).toMatchObject({ status: 'refused', reason: 'policy-mismatch' });
  });
});

describe('namespace failure and lifecycle evidence', () => {
  it('retains failed observation causes and bounds checked open contention', async () => {
    const f = reservationNamespaceFixture();
    const unavailable = new Error('unavailable');
    vi.spyOn(f.refs, 'inspectRef').mockRejectedValue(unavailable);
    expect(await f.open()).toMatchObject({ status: 'indeterminate', cause: { meta: { operationError: unavailable, inspectionError: unavailable } } });
    vi.restoreAllMocks();
    const update = vi.spyOn(f.refs, 'updateRef').mockRejectedValue(new CasError('race', ErrorCodes.GIT_REF_CONFLICT));
    expect(await f.open()).toMatchObject({ status: 'refused', reason: 'contention' });
    expect(update).toHaveBeenCalledTimes(4);
  });

  it('performs the public lifecycle, reads exact pages and never rearms on reconciliation', async () => {
    const set = await reservationNamespaceFixture().open();
    expect(await set.reserve(identity)).toMatchObject({ status: 'admitted' });
    expect(await set.readEvidence({ ...identity, stage: 'preparation' })).toMatchObject({ reason: 'not-prepared' });
    expect(await set.prepare({ ...identity, evidence: original })).toMatchObject({ status: 'prepared' });
    expect(await set.arm(identity)).toMatchObject({ status: 'armed' });
    expect(await set.reconcile(identity)).toMatchObject({ status: 'recovered', record: { phase: 'armed' } });
    expect(await set.settle({ ...identity, evidence: final })).toMatchObject({ status: 'settled' });
    for (const [stage, expected] of [['preparation', original], ['settlement', final]]) {
      const read = await set.readEvidence({ ...identity, stage });
      expect(read.status).toBe('read');
      const bytes = read.evidence.record;
      expect(bytes).toEqual(expected.record);
      bytes[0] = 99;
      expect(read.evidence.record).toEqual(expected.record);
    }
    expect(await set.cancel(identity)).toMatchObject({ reason: 'irreversible' });
    expect(await set.arm(identity)).toMatchObject({ reason: 'already-settled' });
  });
});

describe('namespace reconciliation', () => {
  it('reconciles installed preparation and settlement pins without supplied replacement evidence', async () => {
    const f = reservationNamespaceFixture();
    const set = await f.open();
    const admitted = await set.reserve(identity);
    const pin = await f.custody.prepare(admitted.record, new ReservationEvidence(original));
    expect(await set.inspect(identity)).toMatchObject({ status: 'inspected', record: { phase: 'reserved' }, custody: { revision: pin.revision } });
    const prepared = await set.reconcile(identity);
    expect(prepared).toMatchObject({ status: 'prepared', record: { preparation: pin.revision } });
    const settledPin = await f.custody.settle(prepared.record, new ReservationEvidence(final));
    expect(await set.readEvidence({ ...identity, stage: 'settlement' })).toMatchObject({ reason: 'not-settled' });
    expect(await set.reconcile(identity)).toMatchObject({ status: 'settled', record: { settlement: settledPin.revision } });
    expect(await set.reconcile(identity)).toMatchObject({ status: 'recovered', record: { phase: 'settled' } });
  });

  it('inspects and cleans cancelled residue without a second refund', async () => {
    const f = reservationNamespaceFixture();
    const set = await f.open();
    const admitted = await set.reserve(identity);
    await set.prepare({ ...identity, evidence: original });
    const deletion = vi.spyOn(f.refs, 'deleteRef').mockRejectedValueOnce(new Error('unavailable'));
    expect(await set.cancel(identity)).toMatchObject({ status: 'cancelled' });
    // The protocol's immediate recovery retries deletion; persist residue by
    // making every cleanup attempt unavailable during the next cancelled retry.
    await f.custody.prepare(admitted.record, new ReservationEvidence(original));
    deletion.mockRejectedValue(new Error('still unavailable'));
    expect(await set.reconcile(identity)).toMatchObject({ status: 'indeterminate' });
    expect(await set.inspect(identity)).toMatchObject({ status: 'inspected', charged: 0, record: { phase: 'cancelled' }, custody: { descriptor: { stage: 'preparation' } } });
    deletion.mockRestore();
    expect(await set.reconcile(identity)).toMatchObject({ status: 'cancelled' });
    expect(await set.inspect(identity)).toMatchObject({ charged: 0, custody: null });
    expect(await set.reserve(identity)).toMatchObject({ reason: 'cancelled' });
  });
});

describe('namespace unavailable custody', () => {
  it('does not replace missing custody or refund an armed charge', async () => {
    const f = reservationNamespaceFixture();
    const set = await f.open();
    await set.reserve(identity);
    await set.prepare({ ...identity, evidence: original });
    await set.arm(identity);
    const inspect = f.refs.inspectRef.bind(f.refs);
    vi.spyOn(f.refs, 'inspectRef').mockImplementation((ref) => ref.includes('reservation-custody/') ? { oid: null, symref: null } : inspect(ref));
    expect(await set.reconcile(identity)).toMatchObject({ status: 'indeterminate' });
    expect(await set.readEvidence({ ...identity, stage: 'preparation' })).toMatchObject({ status: 'indeterminate' });
    expect((await set.list()).charged).toBe(1);
  });
});

describe('reservation boundary failures', () => {
  it('rejects malformed public requests with typed errors before I/O', async () => {
    const f = reservationNamespaceFixture();
    const set = await f.open();
    const observe = vi.spyOn(f.refs, 'inspectRef');
    for (const operation of ['reserve', 'prepare', 'arm', 'settle', 'cancel', 'reconcile', 'inspect', 'readEvidence', 'list']) {
      await expect(set[operation](null)).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    }
    await expect(set.prepare({ ...identity, evidence: null })).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    await expect(set.list({ cursor: 17 })).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    await expect(f.registry.open(null)).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    expect(observe).not.toHaveBeenCalled();
  });

  it('preserves a non-Error port failure behind a real Error cause', async () => {
    const f = reservationNamespaceFixture();
    const set = await f.open();
    vi.spyOn(f.refs, 'inspectRef').mockRejectedValue('transport refused');
    const result = await set.reserve(identity);
    expect(result.status).toBe('indeterminate');
    expect(result.cause).toBeInstanceOf(Error);
    expect(result.cause.meta.originalError).toBe('transport refused');
    const page = await set.list();
    expect(page.cause).toBeInstanceOf(Error);
    expect(page.cause.meta.originalError).toBe('transport refused');
  });
});
