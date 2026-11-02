import ReservationPolicy from './ReservationPolicy.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';

export default class ReservationOpenRefusal {
  constructor(policy, reason) {
    if (!(policy instanceof ReservationPolicy) || !['policy-mismatch', 'contention'].includes(reason)) {
      throw new InvalidOptionsError('Reservation open refusal requires policy and a known reason');
    }
    this.status = 'refused';
    this.policy = policy;
    this.reason = reason;
    Object.freeze(this);
  }
}
