import ReservationListRequest from './ReservationListRequest.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';
import { CasError, ErrorCodes } from '../errors/index.js';

/** A failed page has no partial records and never advances the supplied cursor. */
export default class ReservationListUnavailable {
  constructor(request, cause) {
    if (!(request instanceof ReservationListRequest)) {
      throw new InvalidOptionsError('Unavailable reservation page requires its original request');
    }
    this.status = 'unavailable';
    this.namespace = request.namespace;
    this.cursor = request.cursor;
    this.cause = cause instanceof Error ? cause : new CasError('Reservation listing failed', ErrorCodes.GIT_ERROR, { originalError: cause });
    Object.freeze(this);
  }
}
