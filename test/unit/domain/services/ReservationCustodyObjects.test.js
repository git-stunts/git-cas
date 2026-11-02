import { describe, expect, it, vi } from 'vitest';
import { reservationLedgerFixture as fixture } from '../../../helpers/reservation-ledger.js';
import ReservationEvidence from '../../../../src/domain/value-objects/ReservationEvidence.js';
import ReservationRecord from '../../../../src/domain/services/ReservationRecord.js';
import { utf8Encode } from '../../../../src/domain/encoding/utf8.js';

const ATTEMPT = { key: 'first', binding: 'a'.repeat(64) };
const CUSTODY_PREFIX = 'refs/cas/reservation-custody/';

async function prepared() {
  const context = fixture();
  const ledger = context.open();
  await ledger.reserve(ATTEMPT);
  const result = await ledger.prepare({ ...ATTEMPT, evidence: new ReservationEvidence({ record: utf8Encode('original') }) });
  expect(result.status).toBe('prepared');
  const root = await context.refs.resolveTree(result.record.preparation);
  const entries = await context.persistence.readTree(root);
  return { ...context, ledger, record: result.record, root, entries };
}

describe('Custody validates actual object types', () => {
  it.each(['support', 'parent'])('rejects a blob falsely declared as a %s', async (kind) => {
    const { open, persistence, refs } = fixture();
    const ledger = open();
    await ledger.reserve(ATTEMPT);
    const blob = await persistence.writeBlob(utf8Encode('not a tree or commit'));
    const roots = kind === 'support' ? { supports: [{ type: 'tree', oid: blob }] } : { parents: [blob] };
    const write = vi.spyOn(refs, 'updateRef');
    const result = await ledger.prepare({ ...ATTEMPT, evidence: new ReservationEvidence({ record: utf8Encode('record'), ...roots }) });
    expect(result.status).toBe('indeterminate');
    expect(write).not.toHaveBeenCalled();
    expect(await ledger.inspect(ATTEMPT)).toMatchObject({ status: 'recovered', record: { phase: 'reserved' } });
  });

  it('rejects a dangling symbolic custody ref without changing its target', async () => {
    const { open, refs } = fixture();
    const ledger = open();
    await ledger.reserve(ATTEMPT);
    const inspect = refs.inspectRef.bind(refs);
    vi.spyOn(refs, 'inspectRef').mockImplementation((ref) => ref.startsWith(CUSTODY_PREFIX) ? { oid: null, symref: 'refs/heads/missing' } : inspect(ref));
    const write = vi.spyOn(refs, 'updateRef');
    expect((await ledger.prepare({ ...ATTEMPT, evidence: new ReservationEvidence({ record: utf8Encode('record') }) })).status).toBe('indeterminate');
    expect(write).not.toHaveBeenCalled();
  });
});

describe('Custody metadata bounds precede content reads', () => {
  it('rejects an oversized commit before resolving its tree', async () => {
    const { objects, persistence, refs, record } = await prepared();
    const original = persistence.readObjectSize.bind(persistence);
    vi.spyOn(persistence, 'readObjectSize').mockImplementation((oid) => oid === record.preparation ? 16385 : original(oid));
    const read = vi.spyOn(refs, 'resolveTree');
    await expect(objects.read(record.preparation)).rejects.toMatchObject({ code: 'RESERVATION_CORRUPT' });
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects an oversized descriptor before reading bytes', async () => {
    const { objects, persistence, record, entries } = await prepared();
    const metadata = entries.find((entry) => entry.name === 'descriptor').oid;
    const original = persistence.readObjectSize.bind(persistence);
    vi.spyOn(persistence, 'readObjectSize').mockImplementation((oid) => oid === metadata ? 16385 : original(oid));
    const read = vi.spyOn(persistence, 'readBlob');
    await expect(objects.read(record.preparation)).rejects.toMatchObject({ code: 'RESERVATION_CORRUPT' });
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects an oversized support tree before enumerating entries', async () => {
    const { objects, persistence, record, entries } = await prepared();
    const support = entries.find((entry) => entry.name === 'support').oid;
    const original = persistence.readObjectSize.bind(persistence);
    vi.spyOn(persistence, 'readObjectSize').mockImplementation((oid) => oid === support ? 8193 : original(oid));
    const read = vi.spyOn(persistence, 'readTree');
    await expect(objects.read(record.preparation)).rejects.toMatchObject({ code: 'RESERVATION_CORRUPT' });
    expect(read).not.toHaveBeenCalledWith(support);
  });
});

describe('Custody descriptors must match their physical edges', () => {
  it('rejects undeclared commit parents', async () => {
    const { objects, refs, record } = await prepared();
    vi.spyOn(refs, 'resolveParents').mockResolvedValue(['c'.repeat(40)]);
    await expect(objects.read(record.preparation)).rejects.toMatchObject({ code: 'RESERVATION_CORRUPT' });
  });

  it('rejects a gitlink where the support tree must be', async () => {
    const { objects, persistence, record, root, entries } = await prepared();
    const original = persistence.readTree.bind(persistence);
    const malformed = entries.map((entry) => entry.name === 'support' ? { ...entry, mode: '160000', type: 'commit' } : entry);
    vi.spyOn(persistence, 'readTree').mockImplementation((oid) => oid === root ? malformed : original(oid));
    await expect(objects.read(record.preparation)).rejects.toMatchObject({ code: 'RESERVATION_CORRUPT' });
  });

  it('never deletes a pin under another binding, even with a cancelled candidate', async () => {
    const { custody, refs } = await prepared();
    const wrong = new ReservationRecord({ ...ATTEMPT, binding: 'b'.repeat(64), phase: 'cancelled' });
    const remove = vi.spyOn(refs, 'deleteRef');
    await expect(custody.discardCancelled(wrong)).rejects.toMatchObject({ code: 'RESERVATION_CORRUPT' });
    expect(remove).not.toHaveBeenCalled();
  });
});
