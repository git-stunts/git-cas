import ReservationRecord from '../services/ReservationRecord.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';

/** Failed observation retains its cause; absence after failure is not a refund. */
export default class ReservationIndeterminate {
  constructor(record, cause) {
    if (!(record instanceof ReservationRecord)) {
      throw new InvalidOptionsError('Indeterminate reservation requires its original attempt');
    }
    this.status = 'indeterminate';
    this.key = record.key;
    this.binding = record.binding;
    this.cause = cause;
    Object.freeze(this);
  }
}
