import PortNotImplementedError from '../domain/errors/PortNotImplementedError.js';

export const RESERVATION_CUSTODY_MAX_BYTES = 16 * 1024;

/** Versioned canonical descriptor boundary for actual custody edges. */
export default class ReservationCustodyCodecPort {
  encode(_descriptor) {
    throw new PortNotImplementedError('Reservation custody encoding is not implemented');
  }

  decode(_bytes) {
    throw new PortNotImplementedError('Reservation custody decoding is not implemented');
  }
}
