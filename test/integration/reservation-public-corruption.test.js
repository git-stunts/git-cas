import { afterEach, describe, expect, it, vi } from 'vitest';
import ContentAddressableStore from '../../index.js';
import NativeReservationHarness from '../helpers/NativeReservationHarness.js';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 30_000 });
const harness = new NativeReservationHarness();
const LEDGER = 'refs/cas/reservations/test/admission';
const IDENTITY = { key: 'protected', binding: 'a'.repeat(64) };
const OPTIONS = { namespace: 'test/admission', capacity: { unit: 'record-slot', limit: 1 } };
afterEach(async () => { await harness.destroy(); });

function commit(repo, tree, parents = []) {
  return harness.git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
    'commit-tree', tree, ...parents.flatMap((oid) => ['-p', oid])], 'corrupt fixture');
}

function refs(repo) {
  return harness.git(repo, ['for-each-ref', '--format=%(refname) %(objectname) %(symref)']);
}

function malformedLedger(repo, kind) {
  const prior = harness.git(repo, ['rev-parse', LEDGER]);
  const originalTree = harness.git(repo, ['rev-parse', `${prior}^{tree}`]);
  if (kind === 'parented') {
    return commit(repo, originalTree, [prior]);
  }
  const empty = harness.git(repo, ['mktree'], '');
  if (kind === 'missing-header') {
    return commit(repo, empty);
  }
  const badHeader = harness.git(repo, ['hash-object', '-w', '--stdin'], 'not a canonical header');
  const tree = harness.git(repo, ['mktree'], `100644 blob ${badHeader}\theader\n040000 tree ${empty}\trecords\n`);
  return commit(repo, tree);
}

describe.each(['sha1', 'sha256'])('public %s malformed ledger authority', (format) => {
  it.each(['missing-header', 'malformed-header', 'parented'])('refuses %s without replacing the installed revision', async (kind) => {
    const repo = harness.repository(format);
    const { cas } = await harness.openPublic(repo);
    const broken = malformedLedger(repo, kind);
    harness.git(repo, ['update-ref', LEDGER, broken]);
    const before = refs(repo);
    expect(await cas.reservations.open(OPTIONS)).toMatchObject({ status: 'indeterminate' });
    expect(refs(repo)).toBe(before);
    await harness.closeAdapters();
    harness.git(repo, ['gc', '--prune=now']);
    const store = await ContentAddressableStore.open({ cwd: repo });
    try {
      expect(await store.reservations.open(OPTIONS)).toMatchObject({ status: 'indeterminate' });
      expect(refs(repo)).toBe(before);
    } finally {
      await store.close();
    }
  });

  it('refuses a dangling symbolic ledger without creating its target', async () => {
    const repo = harness.repository(format);
    const { cas } = await harness.openPublic(repo);
    harness.git(repo, ['update-ref', '-d', LEDGER]);
    harness.git(repo, ['symbolic-ref', LEDGER, 'refs/heads/missing']);
    expect(await cas.reservations.open(OPTIONS)).toMatchObject({ status: 'indeterminate' });
    expect(harness.git(repo, ['symbolic-ref', LEDGER])).toBe('refs/heads/missing');
    expect(harness.git(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads/'])).toBe('');
  });
});

describe.each(['sha1', 'sha256'])('public %s broken prepared custody', (format) => {
  it.each(['missing', 'symbolic', 'malformed'])('refuses fresh permission with a %s evidence pin', async (kind) => {
    const repo = harness.repository(format);
    const { namespace } = await harness.openPublic(repo);
    expect((await namespace.reserve(IDENTITY)).status).toBe('admitted');
    expect((await namespace.prepare({ ...IDENTITY, evidence: { record: new Uint8Array([1, 2, 3]) } })).status).toBe('prepared');
    await harness.closeAdapters();
    const pin = harness.git(repo, ['for-each-ref', '--format=%(refname)', 'refs/cas/reservation-custody/']);
    expect(pin.split('\n')).toHaveLength(1);
    expect(pin).not.toBe('');
    corruptPin(repo, pin, kind);
    harness.git(repo, ['reflog', 'expire', '--expire=now', '--all']);
    harness.git(repo, ['gc', '--prune=now']);
    const before = refs(repo);
    const reopened = (await harness.openPublic(repo)).namespace;
    expect(await reopened.inspect(IDENTITY)).toMatchObject({ status: 'indeterminate' });
    expect(await reopened.reconcile(IDENTITY)).toMatchObject({ status: 'indeterminate' });
    expect(await reopened.arm(IDENTITY)).toMatchObject({ status: 'indeterminate' });
    expect(await reopened.list()).toMatchObject({ status: 'page', charged: 1, records: [expect.objectContaining({ phase: 'prepared' })] });
    expect(refs(repo)).toBe(before);
  });
});

function corruptPin(repo, pin, kind) {
  if (kind === 'missing') {
    harness.git(repo, ['update-ref', '-d', pin]);
  } else if (kind === 'symbolic') {
    const oid = harness.git(repo, ['rev-parse', pin]);
    harness.git(repo, ['update-ref', 'refs/heads/alias', oid]);
    harness.git(repo, ['symbolic-ref', pin, 'refs/heads/alias']);
  } else {
    const empty = harness.git(repo, ['mktree'], '');
    harness.git(repo, ['update-ref', pin, commit(repo, empty)]);
  }
}
