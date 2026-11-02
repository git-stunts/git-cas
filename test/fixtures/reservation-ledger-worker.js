import ReservationLedger from '../../src/domain/services/ReservationLedger.js';
import ReservationLedgerStore from '../../src/domain/services/ReservationLedgerStore.js';
import ReservationIndex from '../../src/domain/services/ReservationIndex.js';
import ReservationPolicy from '../../src/domain/value-objects/ReservationPolicy.js';
import GitRefAdapter from '../../src/infrastructure/adapters/GitRefAdapter.js';
import GitPersistenceAdapter from '../../src/infrastructure/adapters/GitPersistenceAdapter.js';
import ReservationLedgerCodec from '../../src/infrastructure/codecs/ReservationLedgerCodec.js';
import ReservationRecordCodec from '../../src/infrastructure/codecs/ReservationRecordCodec.js';
import { CasError, ErrorCodes } from '../../src/domain/errors/index.js';
import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';
import { getTestCryptoAdapter } from '../helpers/crypto-adapter.js';
import { createReservationCustody } from '../helpers/reservation-custody.js';
import ReservationEvidence from '../../src/domain/value-objects/ReservationEvidence.js';
import { utf8Encode } from '../../src/domain/encoding/utf8.js';

if (process.env.GIT_STUNTS_DOCKER !== '1' || !process.send) {
  throw new Error('Reservation ledger worker requires Docker and a parent IPC harness');
}

class BarrierStore extends ReservationLedgerStore {
  #observed = false;

  async read(namespace) {
    const snapshot = await super.read(namespace);
    if (!this.#observed) {
      this.#observed = true;
      const released = new Promise((resolve) => process.once('message', resolve));
      process.send({ event: 'observed', revision: snapshot?.revision ?? null });
      await released;
    }
    return snapshot;
  }
}

class LostAcknowledgementRefs extends GitRefAdapter {
  #lost = false;

  async updateRef(options) {
    await super.updateRef(options);
    if (!this.#lost) {
      this.#lost = true;
      throw new CasError('Injected lost acknowledgement after native ref update', ErrorCodes.GIT_ERROR);
    }
  }
}

async function run() {
  const [repo, key, fault, operation] = process.argv.slice(2);
  if (!['reserve', 'arm', 'cancel', 'settle'].includes(operation)) {
    throw new Error('Unsupported reservation worker operation');
  }
  const plumbing = await createGitPlumbing({ cwd: repo });
  const persistence = new GitPersistenceAdapter({ plumbing });
  const refs = fault === 'lost-ack' ? new LostAcknowledgementRefs({ plumbing }) : new GitRefAdapter({ plumbing });
  try {
    const store = new BarrierStore({ persistence, refs, codec: new ReservationLedgerCodec() });
    const crypto = await getTestCryptoAdapter();
    const index = new ReservationIndex({ persistence, crypto, codec: new ReservationRecordCodec() });
    const policy = new ReservationPolicy({ namespace: 'test/admission', capacity: { unit: 'record-slot', limit: 1 } });
    const { custody } = createReservationCustody({ namespace: policy.namespace, persistence, refs, crypto });
    const ledger = new ReservationLedger({ policy, index, store, custody });
    const identity = { key, binding: 'a'.repeat(64) };
    const input = operation === 'settle' ? { ...identity, evidence: new ReservationEvidence({ record: utf8Encode('native-final') }) } : identity;
    const result = await ledger[operation](input);
    process.send({ event: 'result', status: result.status, reason: result.reason,
      revision: result.revision, phase: result.record?.phase, key: result.record?.key ?? result.key });
  } finally {
    await refs.close();
    await persistence.close();
  }
}

try {
  await run();
} catch (error) {
  process.send({ event: 'error', message: error.message });
  process.exitCode = 1;
} finally {
  process.disconnect();
}
