import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import ReservationIndex from '../../src/domain/services/ReservationIndex.js';
import ReservationRecord from '../../src/domain/services/ReservationRecord.js';
import GitPersistenceAdapter from '../../src/infrastructure/adapters/GitPersistenceAdapter.js';
import ReservationRecordCodec from '../../src/infrastructure/codecs/ReservationRecordCodec.js';
import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';
import { getTestCryptoAdapter } from '../helpers/crypto-adapter.js';

if (process.env.GIT_STUNTS_DOCKER !== '1') {
  throw new Error('Reservation index integration must run in Docker');
}

vi.setConfig({ testTimeout: 90_000, hookTimeout: 30_000 });
const folders = [];
const adapters = [];
const FIRST_REF = 'refs/cas/index-witness/first';
const CURRENT_REF = 'refs/cas/index-witness/current';

function git(repo, args, input) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', input, timeout: 20_000 });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Git failed');
  }
  return result.stdout.trim();
}

async function openIndex(repo) {
  const persistence = new GitPersistenceAdapter({ plumbing: await createGitPlumbing({ cwd: repo }) });
  adapters.push(persistence);
  const crypto = await getTestCryptoAdapter();
  return new ReservationIndex({ persistence, crypto, codec: new ReservationRecordCodec() });
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

function record(key) {
  return new ReservationRecord({ key, binding: 'd'.repeat(64), phase: 'reserved' });
}

async function populate(index) {
  const first = await index.put(null, record('original'));
  let current = first;
  for (let n = 0; n < 16; n++) {
    current = await index.put(current, record(`additional-${n}`));
  }
  current = await index.put(current, record('original').cancel());
  return { first, current };
}

describe.each(['sha1', 'sha256'])('native %s reservation point index', (format) => {
  it('reads independent frozen trees after adapter reopen and real GC', async () => {
    const repo = mkdtempSync(path.join(os.tmpdir(), `cas-reservation-index-${format}-`));
    folders.push(repo);
    git(repo, ['init', '--bare', `--object-format=${format}`]);
    const { first, current } = await populate(await openIndex(repo));
    expect(current.length).toBe(format === 'sha1' ? 40 : 64);
    // The harness supplies retention roots. This is NOT the reservation ledger
    // or custody service and grants no admission/arming/settlement permission.
    git(repo, ['update-ref', FIRST_REF, first]);
    git(repo, ['update-ref', CURRENT_REF, current]);
    await closeAdapters();
    git(repo, ['gc', '--prune=now']);
    const reopened = await openIndex(repo);
    expect((await reopened.get(first, 'original')).phase).toBe('reserved');
    expect((await reopened.get(current, 'original')).charge).toBe(0);
    expect(await reopened.get(first, 'additional-15')).toBeNull();
    for (let n = 0; n < 16; n++) {
      expect((await reopened.get(current, `additional-${n}`)).binding).toBe('d'.repeat(64));
    }
    expect(await reopened.get(current, 'never-inserted')).toBeNull();
  });
});
