import { createHash } from 'node:crypto';
import ReservationLedger from '../../src/domain/services/ReservationLedger.js';
import ReservationLedgerStore from '../../src/domain/services/ReservationLedgerStore.js';
import ReservationPolicy from '../../src/domain/value-objects/ReservationPolicy.js';
import ReservationIndex from '../../src/domain/services/ReservationIndex.js';
import ReservationLedgerCodec from '../../src/infrastructure/codecs/ReservationLedgerCodec.js';
import ReservationRecordCodec from '../../src/infrastructure/codecs/ReservationRecordCodec.js';
import { CasError, ErrorCodes } from '../../src/domain/errors/index.js';
import CryptoPort from '../../src/ports/CryptoPort.js';
import MemoryPersistenceAdapter from './MemoryPersistenceAdapter.js';
import MemoryRefAdapter from './MemoryRefAdapter.js';
import { createReservationCustody } from './reservation-custody.js';

class RouteCrypto extends CryptoPort {
  async sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
  }
}

// Both ports see the same model commit metadata. Native integration separately
// checks real Git object bytes, types, hashes and parent edges.
class LedgerPersistence extends MemoryPersistenceAdapter {
  constructor(commits) {
    super();
    this.commits = commits;
  }

  async readObjectType(oid) {
    return this.commits.has(oid) ? 'commit' : await super.readObjectType(oid);
  }

  async readObjectSize(oid) {
    return this.commits.get(oid)?.length ?? await super.readObjectSize(oid);
  }
}

class CheckedRefs extends MemoryRefAdapter {
  constructor(commits) {
    super();
    this.commits = commits;
  }

  async createCommit(options) {
    const oid = await super.createCommit(options);
    const parents = options.parentOids ?? (options.parentOid ? [options.parentOid] : []);
    const text = [options.treeOid, ...parents, options.message].join('\n');
    this.commits.set(oid, new globalThis.TextEncoder().encode(text));
    return oid;
  }

  async updateRef(options) {
    try {
      await super.updateRef(options);
    } catch (error) {
      // The legacy memory helper predates the port's structured conflict code.
      if (error.code === ErrorCodes.GIT_ERROR && Object.hasOwn(error.meta, 'expectedOldOid')) {
        throw new CasError('Checked ref conflict', ErrorCodes.GIT_REF_CONFLICT, error.meta);
      }
      throw error;
    }
  }
}

export function reservationLedgerFixture() {
  const commits = new Map();
  const persistence = new LedgerPersistence(commits);
  const refs = new CheckedRefs(commits);
  const crypto = new RouteCrypto();
  const index = new ReservationIndex({ persistence, crypto, codec: new ReservationRecordCodec() });
  const store = new ReservationLedgerStore({ persistence, refs, codec: new ReservationLedgerCodec() });
  const { custody, objects } = createReservationCustody({ namespace: 'test/admission', persistence, refs, crypto });
  const open = (limit = 1) => new ReservationLedger({
    policy: new ReservationPolicy({ namespace: 'test/admission', capacity: { unit: 'record-slot', limit } }),
    index, store, custody,
  });
  return { persistence, refs, index, store, custody, objects, open };
}
