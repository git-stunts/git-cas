import ReservationEvidence from './ReservationEvidence.js';
import ReservationInspection from './ReservationInspection.js';
import ReservationLedgerSnapshot from './ReservationLedgerSnapshot.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';

/** Copy-owned page bytes at the acknowledged preparation or settlement. */
export default class ReservationEvidenceRead {
  constructor({ inspection, stage, custodyRevision, evidence }) {
    if (!(inspection instanceof ReservationInspection) || !(evidence instanceof ReservationEvidence) ||
        !['preparation', 'settlement'].includes(stage)) {
      throw new InvalidOptionsError('Reservation evidence read requires an inspection, stage and validated page');
    }
    ReservationLedgerSnapshot.assertOid(custodyRevision);
    this.status = 'read';
    this.attempt = inspection.record;
    this.ledgerRevision = inspection.revision;
    this.stage = stage;
    this.custodyRevision = custodyRevision;
    this.evidence = evidence;
    Object.freeze(this);
  }
}
