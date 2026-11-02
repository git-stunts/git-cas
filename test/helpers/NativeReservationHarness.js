import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import ReservationLedger from '../../src/domain/services/ReservationLedger.js';
import ReservationLedgerStore from '../../src/domain/services/ReservationLedgerStore.js';
import ReservationIndex from '../../src/domain/services/ReservationIndex.js';
import ReservationPolicy from '../../src/domain/value-objects/ReservationPolicy.js';
import NativeReservationFaultRefs from './NativeReservationFaultRefs.js';
import GitPersistenceAdapter from '../../src/infrastructure/adapters/GitPersistenceAdapter.js';
import ReservationLedgerCodec from '../../src/infrastructure/codecs/ReservationLedgerCodec.js';
import ReservationRecordCodec from '../../src/infrastructure/codecs/ReservationRecordCodec.js';
import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';
import { getTestCryptoAdapter } from './crypto-adapter.js';
import { createReservationCustody } from './reservation-custody.js';

/** Owns finite native fixtures under the Docker runner's bounded TMPDIR. */
export default class NativeReservationHarness {
  #folders = [];
  #adapters = [];

  repository(format) {
    const repo = mkdtempSync(path.join(os.tmpdir(), `cas-custody-${format}-`));
    this.#folders.push(repo);
    this.git(repo, ['init', '--bare', `--object-format=${format}`]);
    return repo;
  }

  git(repo, args) {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 20_000 });
    if (result.error || result.status !== 0) {
      throw result.error ?? new Error(result.stderr || result.stdout || 'Git failed');
    }
    return result.stdout.trim();
  }

  async open(repo) {
    const plumbing = await createGitPlumbing({ cwd: repo });
    const persistence = new GitPersistenceAdapter({ plumbing });
    const refs = new NativeReservationFaultRefs({ plumbing });
    this.#adapters.push(refs, persistence);
    const crypto = await getTestCryptoAdapter();
    const index = new ReservationIndex({ persistence, crypto, codec: new ReservationRecordCodec() });
    const store = new ReservationLedgerStore({ persistence, refs, codec: new ReservationLedgerCodec() });
    const policy = new ReservationPolicy({ namespace: 'test/admission', capacity: { unit: 'record-slot', limit: 1 } });
    const { custody, objects } = createReservationCustody({ namespace: policy.namespace, persistence, refs, crypto });
    return { persistence, refs, index, store, custody, objects, ledger: new ReservationLedger({ policy, index, store, custody }) };
  }

  async closeAdapters() {
    for (const adapter of this.#adapters.splice(0)) {
      await adapter.close();
    }
  }

  async destroy() {
    await this.closeAdapters();
    for (const folder of this.#folders.splice(0)) {
      rmSync(folder, { recursive: true, force: true });
    }
  }
}
