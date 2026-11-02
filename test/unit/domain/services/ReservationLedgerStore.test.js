import { describe, expect, it, vi } from 'vitest';
import { reservationLedgerFixture as fixture } from '../../../helpers/reservation-ledger.js';
import ReservationLedgerHeader from '../../../../src/domain/value-objects/ReservationLedgerHeader.js';
import ReservationPolicy from '../../../../src/domain/value-objects/ReservationPolicy.js';
import ReservationLedgerCodec from '../../../../src/infrastructure/codecs/ReservationLedgerCodec.js';
import GitRefPort from '../../../../src/ports/GitRefPort.js';

const ATTEMPT = { key: 'first', binding: 'a'.repeat(64) };
const NAMESPACE = 'test/admission';
const REF = `refs/cas/reservations/${NAMESPACE}`;

async function admitted() {
  const context = fixture();
  await context.open().reserve(ATTEMPT);
  const snapshot = await context.store.read(NAMESPACE);
  const root = await context.refs.resolveTree(snapshot.revision);
  return { ...context, snapshot, root };
}

describe('ReservationLedgerStore bounded commit reads', () => {
  it.each([16385, -1, NaN, Infinity])('rejects commit size %s before reading parents', async (size) => {
    const { persistence, refs, store, snapshot } = await admitted();
    const original = persistence.readObjectSize.bind(persistence);
    vi.spyOn(persistence, 'readObjectSize').mockImplementation((oid) => oid === snapshot.revision ? size : original(oid));
    const read = vi.spyOn(refs, 'resolveParents');
    await expect(store.read(NAMESPACE)).rejects.toMatchObject({ code: 'RESERVATION_CORRUPT' });
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects a noncommit authority before decoding it', async () => {
    const { persistence, refs, store } = await admitted();
    vi.spyOn(persistence, 'readObjectType').mockResolvedValue('tag');
    const read = vi.spyOn(refs, 'resolveParents');
    await expect(store.read(NAMESPACE)).rejects.toMatchObject({ code: 'RESERVATION_CORRUPT' });
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects a parent chain instead of retaining it as ledger history', async () => {
    const { refs, store, root, snapshot } = await admitted();
    const revision = await refs.createCommit({ treeOid: root, parentOids: [snapshot.revision], message: 'invalid ancestry' });
    await refs.updateRef({ ref: REF, newOid: revision, expectedOldOid: snapshot.revision });
    await expect(store.read(NAMESPACE)).rejects.toMatchObject({ code: 'RESERVATION_CORRUPT' });
  });

  it('fails closed when exact inspection is unsupported', async () => {
    await expect(new GitRefPort().inspectRef(REF)).rejects.toThrowError();
  });
});

describe('ReservationLedgerStore bounded tree and header reads', () => {
  it('rejects an oversized root before decoding entries', async () => {
    const { persistence, store, root } = await admitted();
    const original = persistence.readObjectSize.bind(persistence);
    vi.spyOn(persistence, 'readObjectSize').mockImplementation((oid) => oid === root ? 2049 : original(oid));
    const read = vi.spyOn(persistence, 'readTree');
    await expect(store.read(NAMESPACE)).rejects.toMatchObject({ code: 'RESERVATION_CORRUPT' });
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects an oversized header before reading bytes', async () => {
    const { persistence, store, root } = await admitted();
    const header = (await persistence.readTree(root)).find((entry) => entry.name === 'header');
    const original = persistence.readObjectSize.bind(persistence);
    vi.spyOn(persistence, 'readObjectSize').mockImplementation((oid) => oid === header.oid ? 16385 : original(oid));
    const read = vi.spyOn(persistence, 'readBlob');
    await expect(store.read(NAMESPACE)).rejects.toMatchObject({ code: 'RESERVATION_CORRUPT' });
    expect(read).not.toHaveBeenCalled();
  });

  it('refuses a renamed or executable header entry', async () => {
    const { persistence, store, root } = await admitted();
    const entries = await persistence.readTree(root);
    vi.spyOn(persistence, 'readTree').mockResolvedValue(entries.map((entry) => ({ ...entry, mode: '100755' })));
    await expect(store.read(NAMESPACE)).rejects.toMatchObject({ code: 'RESERVATION_CORRUPT' });
  });
});

describe('ReservationLedgerStore namespace identity', () => {
  it('refuses another namespace header at the canonical ref', async () => {
    const { persistence, store } = await admitted();
    const policy = new ReservationPolicy({ namespace: 'other', capacity: { unit: 'record-slot', limit: 1 } });
    const bytes = new ReservationLedgerCodec().encode(new ReservationLedgerHeader({ policy, charged: 1 }));
    vi.spyOn(persistence, 'readBlob').mockResolvedValue(bytes);
    await expect(store.read(NAMESPACE)).rejects.toMatchObject({ code: 'RESERVATION_CORRUPT' });
  });

  it('refuses a locally inconsistent charge instead of recovering permission', async () => {
    const { store, open, snapshot } = await admitted();
    await store.write({ before: snapshot, indexRoot: snapshot.indexRoot,
      header: new ReservationLedgerHeader({ policy: snapshot.header.policy, charged: 0 }) });
    expect(await open().reserve(ATTEMPT)).toMatchObject({ status: 'indeterminate', cause: { code: 'RESERVATION_CORRUPT' } });
  });

  it('refuses policy replacement at the store boundary', async () => {
    const { store, snapshot } = await admitted();
    const policy = new ReservationPolicy({ namespace: NAMESPACE, capacity: { unit: 'record-slot', limit: 2 } });
    await expect(store.write({ before: snapshot, indexRoot: snapshot.indexRoot,
      header: new ReservationLedgerHeader({ policy, charged: 1 }) })).rejects.toMatchObject({ code: 'RESERVATION_CORRUPT' });
  });
});
