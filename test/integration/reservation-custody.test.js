import { afterEach, describe, expect, it, vi } from 'vitest';
import NativeReservationHarness from '../helpers/NativeReservationHarness.js';
import { runReservationProcesses } from '../helpers/reservation-ledger-processes.js';
import ReservationEvidence from '../../src/domain/value-objects/ReservationEvidence.js';
import { utf8Encode, utf8Decode } from '../../src/domain/encoding/utf8.js';

if (process.env.GIT_STUNTS_DOCKER !== '1') {
  throw new Error('Reservation custody integration must run in Docker');
}

vi.setConfig({ testTimeout: 90_000, hookTimeout: 30_000 });
const harness = new NativeReservationHarness();
const ATTEMPT = { key: 'same', binding: 'a'.repeat(64) };
const NAMESPACE = 'test/admission';
const page = (text) => new ReservationEvidence({ record: utf8Encode(text) });
afterEach(async () => await harness.destroy());

async function prepared(format) {
  const repo = harness.repository(format);
  const context = await harness.open(repo);
  await context.ledger.reserve(ATTEMPT);
  const result = await context.ledger.prepare({ ...ATTEMPT, evidence: page('original') });
  expect(result.status).toBe('prepared');
  return { ...context, repo, record: result.record };
}

async function history(context) {
  const blob = await context.persistence.writeBlob(utf8Encode('retained basis'));
  const tree = await context.persistence.writeTree([`100644 blob ${blob}\tbasis`]);
  const parent = await context.refs.createCommit({ treeOid: tree, parentOids: [], message: 'original writer history' });
  return { blob, tree, parent };
}

describe.each(['sha1', 'sha256'])('native %s original and final custody', (format) => {
  it('retains both pages, support trees and history after source-ref removal, reopen and GC', async () => {
    const repo = harness.repository(format);
    const context = await harness.open(repo);
    const basis = await history(context);
    harness.git(repo, ['update-ref', 'refs/heads/source', basis.parent]);
    await context.ledger.reserve(ATTEMPT);
    const preparation = await context.ledger.prepare({ ...ATTEMPT, evidence: new ReservationEvidence({
      record: utf8Encode('original page'), supports: [{ type: 'tree', oid: basis.tree }], parents: [basis.parent],
    }) });
    expect(preparation.status).toBe('prepared');
    expect((await context.ledger.arm(ATTEMPT)).status).toBe('armed');
    const settled = await context.ledger.settle({ ...ATTEMPT, evidence: page('final page') });
    expect(settled.status).toBe('settled');
    await harness.closeAdapters();
    harness.git(repo, ['update-ref', '-d', 'refs/heads/source', basis.parent]);
    harness.git(repo, ['gc', '--prune=now']);
    const reopened = await harness.open(repo);
    const recovered = await reopened.ledger.inspect(ATTEMPT);
    expect(recovered).toMatchObject({ status: 'recovered', record: settled.record });
    const original = await reopened.objects.read(preparation.record.preparation);
    const final = await reopened.custody.verify(recovered.record);
    expect(utf8Decode(await reopened.persistence.readBlob(original.descriptor.recordOid))).toBe('original page');
    expect(utf8Decode(await reopened.persistence.readBlob(final.descriptor.recordOid))).toBe('final page');
    expect(utf8Decode(await reopened.persistence.readBlob(basis.blob))).toBe('retained basis');
    expect(await reopened.persistence.readObjectType(basis.parent)).toBe('commit');
    expect(await reopened.refs.resolveParents(final.revision)).toContain(original.revision);
    expect((await reopened.store.read(NAMESPACE)).header.charged).toBe(1);
    expect(await reopened.ledger.reserve({ ...ATTEMPT, key: 'another' })).toMatchObject({ status: 'refused', reason: 'capacity-full' });
    expect((await reopened.custody.verify(recovered.record)).revision).toBe(final.revision);
    expect(harness.git(repo, ['for-each-ref', '--format=%(refname)']).split('\n')).toHaveLength(2);
  });
});

describe.each(['sha1', 'sha256'])('native %s cancellation and lost permission', (format) => {
  it('removes cancelled custody without keeping it through ledger ancestry', async () => {
    const { repo, ledger, record } = await prepared(format);
    expect((await ledger.cancel(ATTEMPT)).status).toBe('cancelled');
    await harness.closeAdapters();
    harness.git(repo, ['gc', '--prune=now']);
    const reopened = await harness.open(repo);
    expect(await reopened.ledger.inspect(ATTEMPT)).toMatchObject({ status: 'recovered', record: { phase: 'cancelled' } });
    expect(await reopened.custody.read(record)).toBeNull();
    expect((await reopened.store.read(NAMESPACE)).header.charged).toBe(0);
    expect(harness.git(repo, ['for-each-ref', '--format=%(refname)'])).toBe('refs/cas/reservations/test/admission');
    expect(() => harness.git(repo, ['cat-file', '-t', record.preparation])).toThrowError();
    expect((await reopened.ledger.reserve({ ...ATTEMPT, key: 'replacement' })).status).toBe('admitted');
  });

  it('returns no fresh arm permission after a native update loses its response', async () => {
    const { repo } = await prepared(format);
    await harness.closeAdapters();
    const { results } = await runReservationProcesses(repo, ['same'], { operations: ['arm'], fault: 'lost-ack' });
    expect(results[0]).toMatchObject({ status: 'refused', reason: 'already-armed' });
    harness.git(repo, ['gc', '--prune=now']);
    const reopened = await harness.open(repo);
    expect(await reopened.ledger.inspect(ATTEMPT)).toMatchObject({ status: 'recovered', record: { phase: 'armed' } });
    expect(await reopened.ledger.cancel(ATTEMPT)).toMatchObject({ status: 'refused', reason: 'irreversible' });
    expect((await reopened.store.read(NAMESPACE)).header.charged).toBe(1);
  });
});

describe.each(['sha1', 'sha256'])('native %s lifecycle contention', (format) => {
  it('grants fresh arming to only one of two independent callers', async () => {
    const { repo } = await prepared(format);
    await harness.closeAdapters();
    const { observed, results } = await runReservationProcesses(repo, ['same', 'same'], { operations: ['arm', 'arm'] });
    expect(observed[0]).toBe(observed[1]);
    expect(results.map((result) => result.status).sort()).toEqual(['armed', 'refused']);
    expect(results.find((result) => result.status === 'refused').reason).toBe('already-armed');
    const reopened = await harness.open(repo);
    expect((await reopened.store.read(NAMESPACE)).header.charged).toBe(1);
    expect(await reopened.ledger.inspect(ATTEMPT)).toMatchObject({ status: 'recovered', record: { phase: 'armed' } });
  });

  it.each(['arm', 'settle'])('allows only one winner between %s and cancellation', async (operation) => {
    const { repo } = await prepared(format);
    await harness.closeAdapters();
    const { observed, results } = await runReservationProcesses(repo, ['same', 'same'], { operations: [operation, 'cancel'] });
    expect(observed[0]).toBe(observed[1]);
    expect(observed[0]).not.toBeNull();
    const winner = results.find((result) => result.status !== 'refused');
    const allowed = operation === 'arm' ? 'armed' : 'settled';
    expect([allowed, 'cancelled']).toContain(winner.status);
    expect(results.filter((result) => result.status === 'refused')).toHaveLength(1);
    expect(results.find((result) => result.status === 'refused').reason).toBe(winner.status === 'cancelled' ? 'cancelled' : 'irreversible');
    harness.git(repo, ['gc', '--prune=now']);
    const reopened = await harness.open(repo);
    expect(await reopened.ledger.inspect(ATTEMPT)).toMatchObject({ status: 'recovered', record: { phase: winner.status } });
    expect((await reopened.store.read(NAMESPACE)).header.charged).toBe(winner.status === 'cancelled' ? 0 : 1);
  });
});

async function maximumRoots(context) {
  const supports = [];
  const parents = [];
  const empty = await context.persistence.writeTree([]);
  for (let i = 0; i < 64; i++) {
    supports.push({ type: 'blob', oid: await context.persistence.writeBlob(utf8Encode(`support-${i}`)) });
  }
  for (let i = 0; i < 63; i++) {
    parents.push(await context.refs.createCommit({ treeOid: empty, parentOids: [], message: `history-${i}` }));
  }
  return { supports, parents };
}

describe.each(['sha1', 'sha256'])('native %s maximum custody root counts', (format) => {
  it('retains 64 support edges and 63 external parents plus the preparation parent', async () => {
    const repo = harness.repository(format);
    const context = await harness.open(repo);
    const roots = await maximumRoots(context);
    await context.ledger.reserve(ATTEMPT);
    const preparation = await context.ledger.prepare({ ...ATTEMPT,
      evidence: new ReservationEvidence({ record: utf8Encode('maximum original'), ...roots }) });
    expect(preparation.status).toBe('prepared');
    const settlement = await context.ledger.settle({ ...ATTEMPT,
      evidence: new ReservationEvidence({ record: utf8Encode('maximum final'), ...roots }) });
    expect(settlement.status).toBe('settled');
    expect(await context.refs.resolveParents(settlement.record.settlement)).toHaveLength(64);
    await harness.closeAdapters();
    harness.git(repo, ['gc', '--prune=now']);
    const reopened = await harness.open(repo);
    expect(await reopened.ledger.inspect(ATTEMPT)).toMatchObject({ status: 'recovered', record: settlement.record });
    for (const item of roots.supports) {
      expect(await reopened.persistence.readObjectType(item.oid)).toBe('blob');
    }
    for (const parent of roots.parents) {
      expect(await reopened.persistence.readObjectType(parent)).toBe('commit');
    }
    expect(await reopened.persistence.readObjectType(preparation.record.preparation)).toBe('commit');
  });
});
