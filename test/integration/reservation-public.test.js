import { afterEach, describe, expect, it, vi } from 'vitest';
import NativeReservationHarness from '../helpers/NativeReservationHarness.js';

if (process.env.GIT_STUNTS_DOCKER !== '1') {
  throw new Error('Reservation public integration must run in Docker');
}
vi.setConfig({ testTimeout: 180_000, hookTimeout: 30_000 });
const harness = new NativeReservationHarness();
const identity = { key: 'public-attempt', binding: 'a'.repeat(64) };
const original = new Uint8Array([1, 2, 3]);
const final = new Uint8Array([4, 5, 6]);
afterEach(async () => { await harness.destroy(); });

function history(repo) {
  const blob = harness.git(repo, ['hash-object', '-w', '--stdin'], 'retained support');
  const tree = harness.git(repo, ['mktree'], `100644 blob ${blob}\tsupport\n`);
  const parent = harness.git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit-tree', tree], 'original history');
  harness.git(repo, ['update-ref', 'refs/heads/source', parent]);
  return { blob, tree, parent };
}

describe.each(['sha1', 'sha256'])('public %s reservation authority', (format) => {
  it('retains empty namespace policy through close/reopen and GC', async () => {
    const repo = harness.repository(format);
    const { namespace } = await harness.openPublic(repo, 2);
    const revision = namespace.openedRevision;
    await harness.closeAdapters();
    harness.git(repo, ['gc', '--prune=now']);
    const reopened = await harness.openPublic(repo, 2);
    expect(reopened.namespace.openedRevision).toBe(revision);
    expect(await reopened.namespace.list()).toMatchObject({ status: 'page', charged: 0, records: [] });
    expect(await reopened.cas.reservations.open({ namespace: 'test/admission', capacity: { unit: 'record-slot', limit: 3 } }))
      .toMatchObject({ status: 'refused', reason: 'policy-mismatch' });
  });

  it('keeps exact original/final pages, support trees and history after external roots disappear', async () => {
    const repo = harness.repository(format);
    const { blob, tree, parent } = history(repo);
    const { namespace } = await harness.openPublic(repo);
    await namespace.reserve(identity);
    await namespace.prepare({ ...identity, evidence: { record: original, supports: [{ type: 'tree', oid: tree }], parents: [parent] } });
    expect((await namespace.arm(identity)).status).toBe('armed');
    await namespace.settle({ ...identity, evidence: { record: final } });
    await harness.closeAdapters();
    harness.git(repo, ['update-ref', '-d', 'refs/heads/source']);
    harness.git(repo, ['gc', '--prune=now']);
    const reopened = (await harness.openPublic(repo)).namespace;
    expect((await reopened.readEvidence({ ...identity, stage: 'preparation' })).evidence.record).toEqual(original);
    expect((await reopened.readEvidence({ ...identity, stage: 'settlement' })).evidence.record).toEqual(final);
    expect(harness.git(repo, ['cat-file', '-p', blob])).toBe('retained support');
    expect(harness.git(repo, ['cat-file', '-t', parent])).toBe('commit');
    expect(await reopened.reserve({ key: 'refused', binding: identity.binding })).toMatchObject({ reason: 'capacity-full' });
    expect(await reopened.reconcile(identity)).toMatchObject({ status: 'recovered', record: { phase: 'settled' } });
  });
});

describe.each(['sha1', 'sha256'])('public %s bounded inspection', (format) => {
  it('paginates72 records and reports an old collected cursor as unavailable', async () => {
    const repo = harness.repository(format);
    const { namespace } = await harness.openPublic(repo, 73);
    for (let i = 0; i < 72; i++) {
      expect((await namespace.reserve({ key: `record-${i}`, binding: identity.binding })).status).toBe('admitted');
    }
    const first = await namespace.list({ limit: 2, nodeBudget: 129 });
    const records = await collect(namespace, first);
    expect(new Set(records.map((record) => record.key)).size).toBe(72);
    expect(records).toHaveLength(72);
    await namespace.reserve({ key: 'later', binding: identity.binding });
    await harness.closeAdapters();
    harness.git(repo, ['reflog', 'expire', '--expire=now', '--all']);
    harness.git(repo, ['gc', '--prune=now']);
    const reopened = (await harness.openPublic(repo, 73)).namespace;
    expect(await reopened.list({ cursor: first.next })).toMatchObject({ status: 'unavailable', cursor: first.next });
    expect(await reopened.list({ limit: 1 })).toMatchObject({ status: 'page', charged: 73 });
  });

  it('keeps cancelled identities terminal after reopening while admitting another key', async () => {
    const repo = harness.repository(format);
    const { namespace } = await harness.openPublic(repo);
    await namespace.reserve(identity);
    await namespace.prepare({ ...identity, evidence: { record: original } });
    expect((await namespace.cancel(identity)).status).toBe('cancelled');
    await harness.closeAdapters();
    harness.git(repo, ['gc', '--prune=now']);
    const reopened = (await harness.openPublic(repo)).namespace;
    expect(await reopened.reconcile(identity)).toMatchObject({ status: 'cancelled' });
    expect(await reopened.reserve(identity)).toMatchObject({ reason: 'cancelled' });
    expect(await reopened.reserve({ key: 'replacement', binding: identity.binding })).toMatchObject({ status: 'admitted' });
    expect(await reopened.inspect(identity)).toMatchObject({ status: 'inspected', custody: null, record: { phase: 'cancelled' } });
  });
});

async function collect(namespace, first) {
  const records = [];
  let page = first;
  for (let i = 0; i < 150; i++) {
    expect(page.status).toBe('page');
    expect(page.visitedNodes).toBeLessThanOrEqual(129);
    records.push(...page.records);
    if (page.next === null) {
      return records;
    }
    page = await namespace.list({ cursor: JSON.parse(JSON.stringify(page.next)), nodeBudget: 129 });
    expect(page.revision).toBe(first.revision);
  }
  throw new Error('Pagination did not finish within the finite native witness');
}
