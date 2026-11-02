import PortNotImplementedError from '../domain/errors/PortNotImplementedError.js';

export const RESERVATION_RECORD_MAX_BYTES = 16 * 1024;

/** Boundary for the versioned, bounded durable attempt-record format. */
export default class ReservationRecordCodecPort {
  encode(_record) {
    throw new PortNotImplementedError('Reservation record encoding is not implemented');
  }

  decode(_bytes) {
    throw new PortNotImplementedError('Reservation record decoding is not implemented');
  }
}
