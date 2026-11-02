import { describe, expect, it, vi } from 'vitest';
import ReservationLedgerHeader from '../../../../src/domain/value-objects/ReservationLedgerHeader.js';
import ReservationRecord from '../../../../src/domain/services/ReservationRecord.js';
import { CasError, ErrorCodes } from '../../../../src/domain/errors/index.js';
import { reservationLedgerFixture as fixture } from '../../../helpers/reservation-ledger.js';

const BINDING = 'a'.repeat(64);
const REF = 'refs/cas/reservations/test/admission';
const ATTEMPT = { key: 'first', binding: BINDING };

describe('ReservationLedger hard admission', () => {
  it('publishes the record and charged count under one parentless ledger head', async () => {
    const { open, store, refs, index } = fixture();
    const admitted = await open().reserve(ATTEMPT);
    expect(admitted.status).toBe('admitted');
    const snapshot = await store.read('test/admission');
    expect(snapshot.header.charged).toBe(1);
    expect(snapshot.header.policy.limit).toBe(1);
    expect(snapshot.revision).toBe(admitted.revision);
    expect(await refs.resolveParents(snapshot.revision)).toEqual([]);
    expect(await index.get(snapshot.indexRoot, 'first')).toEqual(admitted.record);
  });

  it('refuses a new attempt at capacity without changing the existing head', async () => {
    const { open, refs } = fixture();
    const ledger = open();
    const first = await ledger.reserve(ATTEMPT);
    const refused = await ledger.reserve({ key: 'second', binding: BINDING });
    expect(refused).toMatchObject({ status: 'refused', reason: 'capacity-full', key: 'second', binding: BINDING });
    expect(await refs.resolveRef(REF)).toBe(first.revision);
  });

  it('recovers the exact key at capacity through a new ledger instance', async () => {
    const { open } = fixture();
    const first = await open().reserve(ATTEMPT);
    const recovered = await open().reserve(ATTEMPT);
    expect(recovered).toMatchObject({ status: 'recovered', revision: first.revision, record: first.record });
    expect(Object.isFrozen(recovered)).toBe(true);
  });
});

describe('ReservationLedger conflicting attempts', () => {
  it('admits at most one of two competing keys at capacity one', async () => {
    const { open, store } = fixture();
    const results = await Promise.all([open().reserve(ATTEMPT), open().reserve({ key: 'other', binding: BINDING })]);
    expect(results.map((r) => r.status).sort()).toEqual(['admitted', 'refused']);
    expect(results.find((r) => r.status === 'refused').reason).toBe('capacity-full');
    expect((await store.read('test/admission')).header.charged).toBe(1);
  });

  it('charges concurrent exact retries only once', async () => {
    const { open, store } = fixture();
    const results = await Promise.all([open().reserve(ATTEMPT), open().reserve(ATTEMPT)]);
    expect(results.map((r) => r.status).sort()).toEqual(['admitted', 'recovered']);
    expect((await store.read('test/admission')).header.charged).toBe(1);
  });

  it('refuses different payload binding before considering capacity', async () => {
    const { open, refs } = fixture();
    const first = await open().reserve(ATTEMPT);
    const result = await open().reserve({ key: 'first', binding: 'b'.repeat(64) });
    expect(result).toMatchObject({ status: 'refused', reason: 'binding-conflict' });
    expect(await refs.resolveRef(REF)).toBe(first.revision);
  });

  it('refuses a configured policy change without widening capacity', async () => {
    const { open, refs } = fixture();
    const first = await open().reserve(ATTEMPT);
    const result = await open(2).reserve({ key: 'second', binding: BINDING });
    expect(result).toMatchObject({ status: 'refused', reason: 'policy-mismatch' });
    expect(await refs.resolveRef(REF)).toBe(first.revision);
  });
});

describe('ReservationLedger uncertain responses', () => {
  it('recovers an installed admission after its acknowledgement is lost', async () => {
    const { open, refs, store } = fixture();
    const original = refs.updateRef.bind(refs);
    vi.spyOn(refs, 'updateRef').mockImplementationOnce(async (options) => {
      await original(options);
      throw new CasError('Response lost', ErrorCodes.GIT_ERROR);
    });
    const recovered = await open().reserve(ATTEMPT);
    expect(recovered.status).toBe('recovered');
    expect(recovered.record.key).toBe('first');
    expect((await store.read('test/admission')).header.charged).toBe(1);
  });

  it('keeps uncertainty when a failed mutation is observed absent', async () => {
    const { open, refs } = fixture();
    const error = new CasError('Transport failed', ErrorCodes.GIT_ERROR);
    const write = vi.spyOn(refs, 'updateRef').mockRejectedValue(error);
    const result = await open().reserve(ATTEMPT);
    expect(result).toMatchObject({ status: 'indeterminate', key: 'first', binding: BINDING, cause: error });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('retains both causes when publication and inspection fail', async () => {
    const { open, refs } = fixture();
    const writeError = new CasError('Write response lost', ErrorCodes.GIT_ERROR);
    vi.spyOn(refs, 'updateRef').mockImplementationOnce(async () => {
      vi.spyOn(refs, 'inspectRef').mockRejectedValue(new CasError('Cannot inspect', ErrorCodes.GIT_ERROR));
      throw writeError;
    });
    const result = await open().reserve(ATTEMPT);
    expect(result.status).toBe('indeterminate');
    expect(result.cause.meta.writeError).toBe(writeError);
    expect(result.cause.meta.inspectionError.code).toBe(ErrorCodes.GIT_ERROR);
  });
});

describe('ReservationLedger refusal and corruption', () => {
  it('bounds repeated checked conflicts', async () => {
    const { open, refs } = fixture();
    const write = vi.spyOn(refs, 'updateRef').mockRejectedValue(new CasError('Conflict', ErrorCodes.GIT_REF_CONFLICT));
    expect(await open().reserve(ATTEMPT)).toMatchObject({ status: 'refused', reason: 'contention' });
    expect(write).toHaveBeenCalledTimes(4);
  });

  it('never trusts a symbolic ledger ref as an admission authority', async () => {
    const { open, refs } = fixture();
    vi.spyOn(refs, 'inspectRef').mockResolvedValue({ oid: null, symref: 'refs/other' });
    const write = vi.spyOn(refs, 'updateRef');
    const result = await open().reserve(ATTEMPT);
    expect(result.status).toBe('indeterminate');
    expect(result.cause.code).toBe('RESERVATION_CORRUPT');
    expect(write).not.toHaveBeenCalled();
  });

  it('does not recreate a missing header as an empty namespace', async () => {
    const { open, refs, persistence } = fixture();
    await open().reserve(ATTEMPT);
    const root = await refs.resolveTree(await refs.resolveRef(REF));
    const header = (await persistence.readTree(root)).find((x) => x.name === 'header');
    persistence.deleteObject(header.oid);
    const write = vi.spyOn(refs, 'updateRef');
    expect((await open().reserve({ key: 'second', binding: BINDING })).status).toBe('indeterminate');
    expect(write).not.toHaveBeenCalled();
  });
});

describe('ReservationLedger terminal identity', () => {
  it('keeps a cancelled key terminal even after its slot is available', async () => {
    const { open, refs, store, index } = fixture();
    const admission = await open().reserve(ATTEMPT);
    const before = await store.read('test/admission');
    const root = await index.put(before.indexRoot, admission.record.cancel());
    await store.write({ before, header: new ReservationLedgerHeader({ policy: before.header.policy, charged: 0 }), indexRoot: root });
    const cancelledHead = await refs.resolveRef(REF);
    expect(await open().reserve(ATTEMPT)).toMatchObject({ status: 'refused', reason: 'cancelled' });
    expect(await refs.resolveRef(REF)).toBe(cancelledHead);
    expect((await open().reserve({ key: 'new', binding: BINDING })).status).toBe('admitted');
  });

  it('recovers an armed record without a fresh execution permission', async () => {
    const { open, store, index } = fixture();
    await open().reserve(ATTEMPT);
    const before = await store.read('test/admission');
    const armed = new ReservationRecord({ ...ATTEMPT, phase: 'reserved' }).prepare('b'.repeat(40)).arm();
    await store.write({ before, header: before.header, indexRoot: await index.put(before.indexRoot, armed) });
    const result = await open().reserve(ATTEMPT);
    expect(result.status).toBe('recovered');
    expect(result.record.phase).toBe('armed');
  });
});
