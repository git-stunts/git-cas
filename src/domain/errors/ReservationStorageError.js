import CasError from './CasError.js';
import { ErrorCodes } from './Codes.js';

/** Invalid reservation storage evidence; never a known absence or a refund. */
export default class ReservationStorageError extends CasError {
  constructor(message, meta = {}) {
    super(message, ErrorCodes.RESERVATION_CORRUPT, meta);
  }
}
