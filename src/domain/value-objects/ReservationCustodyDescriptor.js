import ReservationRecord from '../services/ReservationRecord.js';
import CollectionNamespace from './CollectionNamespace.js';
import Oid from './Oid.js';
import ReservationEvidenceRoots from './ReservationEvidenceRoots.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';

/** Immutable meaning of a custody generation, independent of commit timestamps. */
export default class ReservationCustodyDescriptor {
  constructor({ namespace, key, binding, stage, recordOid, roots, preparation = null }) {
    const identity = new ReservationRecord({ key, binding, phase: 'reserved' });
    assertStage(stage, preparation);
    if (!(roots instanceof ReservationEvidenceRoots)) {
      throw new InvalidOptionsError('Custody descriptor requires validated evidence roots');
    }
    roots.assertFormat(recordOid);
    if (preparation !== null && (preparation.length !== recordOid.length || roots.parents.includes(preparation))) {
      throw new InvalidOptionsError('Settlement must use the preparation format without duplicating its parent');
    }
    this.namespace = CollectionNamespace.from(namespace).toString();
    this.key = identity.key;
    this.binding = identity.binding;
    this.stage = stage;
    this.recordOid = recordOid;
    this.roots = roots;
    this.preparation = preparation;
    Object.freeze(this);
  }

  get parents() {
    return this.preparation === null ? this.roots.parents : Object.freeze([this.preparation, ...this.roots.parents]);
  }

  equals(other) {
    return other instanceof ReservationCustodyDescriptor && this.namespace === other.namespace &&
      this.key === other.key && this.binding === other.binding && this.stage === other.stage &&
      this.recordOid === other.recordOid && this.preparation === other.preparation && this.roots.equals(other.roots);
  }
}

function assertStage(stage, preparation) {
  if (!['preparation', 'settlement'].includes(stage) || (stage === 'settlement') !== (preparation !== null)) {
    throw new InvalidOptionsError('Custody stage and preparation reference disagree');
  }
  if (preparation !== null && (!Oid.isValid(preparation) || preparation !== preparation.toLowerCase())) {
    throw new InvalidOptionsError('Settlement preparation must be a canonical Git OID');
  }
}
