import PortNotImplementedError from '../domain/errors/PortNotImplementedError.js';

export const RESERVATION_HEADER_MAX_BYTES = 16 * 1024;

/** Bounded encoding boundary for namespace policy and aggregate charge. */
export default class ReservationLedgerCodecPort {
  encode(_header) {
    throw new PortNotImplementedError('Reservation ledger encoding is not implemented');
  }

  decode(_bytes) {
    throw new PortNotImplementedError('Reservation ledger decoding is not implemented');
  }
}
