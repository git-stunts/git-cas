import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import ReservationLedger from '../../src/domain/services/ReservationLedger.js';
import ReservationLedgerStore from '../../src/domain/services/ReservationLedgerStore.js';
import ReservationIndex from '../../src/domain/services/ReservationIndex.js';
import ReservationPolicy from '../../src/domain/value-objects/ReservationPolicy.js';
import GitRefAdapter from '../../src/infrastructure/adapters/GitRefAdapter.js';
import GitPersistenceAdapter from '../../src/infrastructure/adapters/GitPersistenceAdapter.js';
import ReservationLedgerCodec from '../../src/infrastructure/codecs/ReservationLedgerCodec.js';
import ReservationRecordCodec from '../../src/infrastructure/codecs/ReservationRecordCodec.js';
import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';
import { getTestCryptoAdapter } from '../helpers/crypto-adapter.js';
import { runReservationProcesses } from '../helpers/reservation-ledger-processes.js';
import { createReservationCustody } from '../helpers/reservation-custody.js';

if (process.env.GIT_STUNTS_DOCKER !== '1') {
  throw new Error('Reservation ledger integration must run in Docker');
}

vi.setConfig({ testTimeout: 90_000, hookTimeout: 30_000 });
const folders = [];
const adapters = [];
const NAMESPACE = 'test/admission';
const REF = `refs/cas/reservations/${NAMESPACE}`;
const BINDING = 'a'.repeat(64);

function git(repo, args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 20_000 });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(result.stderr || result.stdout || 'Git failed');
  }
  return result.stdout.trim();
}

function repository(format) {
  const repo = mkdtempSync(path.join(os.tmpdir(), `cas-reservation-ledger-${format}-`));
  folders.push(repo);
  git(repo, ['init', '--bare', `--object-format=${format}`]);
  return repo;
}

async function open(repo) {
  const plumbing = await createGitPlumbing({ cwd: repo });
  const persistence = new GitPersistenceAdapter({ plumbing });
  const refs = new GitRefAdapter({ plumbing });
  adapters.push(refs, persistence);
  const crypto = await getTestCryptoAdapter();
  const index = new ReservationIndex({ persistence, crypto, codec: new ReservationRecordCodec() });
  const store = new ReservationLedgerStore({ persistence, refs, codec: new ReservationLedgerCodec() });
  const policy = new ReservationPolicy({ namespace: NAMESPACE, capacity: { unit: 'record-slot', limit: 1 } });
  const { custody } = createReservationCustody({ namespace: NAMESPACE, persistence, refs, crypto });
  return { store, refs, ledger: new ReservationLedger({ policy, index, store, custody }) };
}

async function closeAdapters() {
  for (const adapter of adapters.splice(0)) {
    await adapter.close();
  }
}

afterEach(async () => {
  await closeAdapters();
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

describe.each(['sha1', 'sha256'])('native %s ledger contention and restart', (format) => {
  it('admits one competing process, retains the charge through GC and recovers only that key', async () => {
    const repo = repository(format);
    const { observed, results } = await runReservationProcesses(repo, ['first', 'second']);
    expect(observed).toEqual([null, null]);
    expect(results.map((result) => result.status).sort()).toEqual(['admitted', 'refused']);
    const winner = results.find((result) => result.status === 'admitted');
    expect(results.find((result) => result.status === 'refused').reason).toBe('capacity-full');
    expect(winner.revision.length).toBe(format === 'sha1' ? 40 : 64);
    git(repo, ['gc', '--prune=now']);
    const { ledger, store, refs } = await open(repo);
    const snapshot = await store.read(NAMESPACE);
    expect(snapshot.header.charged).toBe(1);
    expect(await refs.resolveParents(snapshot.revision)).toEqual([]);
    expect(await ledger.reserve({ key: winner.key, binding: BINDING })).toMatchObject({ status: 'recovered', revision: winner.revision });
    expect(await ledger.reserve({ key: 'third', binding: BINDING })).toMatchObject({ status: 'refused', reason: 'capacity-full' });
    expect(git(repo, ['for-each-ref', '--format=%(refname)'])).toBe(REF);
  });

  it('charges concurrent exact-key retries once across independent processes', async () => {
    const repo = repository(format);
    const { observed, results } = await runReservationProcesses(repo, ['same', 'same']);
    expect(observed).toEqual([null, null]);
    expect(results.map((result) => result.status).sort()).toEqual(['admitted', 'recovered']);
    expect((await (await open(repo)).store.read(NAMESPACE)).header.charged).toBe(1);
  });
});

describe.each(['sha1', 'sha256'])('native %s ledger uncertain acknowledgement', (format) => {
  it('recovers an installed mutation after response loss and a later process restart', async () => {
    const repo = repository(format);
    const first = await runReservationProcesses(repo, ['same'], { fault: 'lost-ack' });
    expect(first.results[0]).toMatchObject({ status: 'recovered', key: 'same', phase: 'reserved' });
    git(repo, ['gc', '--prune=now']);
    const restarted = await runReservationProcesses(repo, ['same']);
    expect(restarted.results[0]).toMatchObject({ status: 'recovered', revision: first.results[0].revision });
    expect((await (await open(repo)).store.read(NAMESPACE)).header.charged).toBe(1);
  });

  it('rejects a dangling symbolic ledger without creating its target', async () => {
    const repo = repository(format);
    git(repo, ['symbolic-ref', REF, 'refs/heads/missing']);
    const { ledger, refs } = await open(repo);
    expect(await refs.inspectRef(REF)).toEqual({ oid: null, symref: 'refs/heads/missing' });
    expect(await ledger.reserve({ key: 'same', binding: BINDING })).toMatchObject({
      status: 'indeterminate', cause: { code: 'RESERVATION_CORRUPT' },
    });
    expect(await refs.inspectRef('refs/heads/missing')).toEqual({ oid: null, symref: null });
    expect(git(repo, ['symbolic-ref', REF])).toBe('refs/heads/missing');
  });
});
