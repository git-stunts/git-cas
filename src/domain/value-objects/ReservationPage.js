import ReservationLedgerSnapshot from './ReservationLedgerSnapshot.js';
import ReservationCursor from './ReservationCursor.js';
import ReservationScan from '../services/ReservationScan.js';
import ReservationStorageError from '../errors/ReservationStorageError.js';

/** Ledger claims at one snapshot; each attempt's live custody is inspected separately. */
export default class ReservationPage {
  constructor(snapshot, scan, phase) {
    if (!(snapshot instanceof ReservationLedgerSnapshot) || !(scan instanceof ReservationScan)) {
      throw new ReservationStorageError('Reservation page requires a snapshot and bounded scan');
    }
    const records = scan.records;
    if (records.some((record) => record.charge > snapshot.header.charged)) {
      throw new ReservationStorageError('Listed record charge exceeds its ledger aggregate');
    }
    this.status = 'page';
    this.policy = snapshot.header.policy;
    this.charged = snapshot.header.charged;
    this.revision = snapshot.revision;
    this.records = records;
    this.visitedNodes = scan.visitedNodes;
    this.next = scan.complete ? null : new ReservationCursor({
      namespace: this.policy.namespace, revision: this.revision, after: scan.after, phase,
    });
    Object.freeze(this);
  }
}
