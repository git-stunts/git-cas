import ReservationPolicy from './ReservationPolicy.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';
import { CasError, ErrorCodes } from '../errors/index.js';

export default class ReservationOpenIndeterminate {
  constructor(policy, cause) {
    if (!(policy instanceof ReservationPolicy)) {
      throw new InvalidOptionsError('Uncertain namespace open requires its requested policy');
    }
    this.status = 'indeterminate';
    this.policy = policy;
    this.cause = cause instanceof Error ? cause : new CasError('Reservation open failed', ErrorCodes.GIT_ERROR, { originalError: cause });
    Object.freeze(this);
  }
}
