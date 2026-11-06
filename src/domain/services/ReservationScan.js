import ReservationListRequest from '../value-objects/ReservationListRequest.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';

/** One bounded DFS; mutable traversal state is private and never a cursor. */
export default class ReservationScan {
  #request;
  #records = [];
  #visited = 0;
  #after;
  #complete = false;

  constructor(request) {
    if (!(request instanceof ReservationListRequest)) {
      throw new InvalidOptionsError('Reservation scan requires a validated listing request');
    }
    this.#request = request;
    this.#after = request.cursor?.after ?? null;
    Object.freeze(this);
  }

  skip(prefix) {
    return this.#after !== null && prefix.padEnd(64, 'f') <= this.#after;
  }

  /** A record above full depth can hold a route an earlier page already listed. */
  listed(route) {
    return this.#after !== null && route <= this.#after;
  }

  visit() {
    if (this.#visited === this.#request.nodeBudget || this.#records.length === this.#request.limit) {
      return false;
    }
    this.#visited++;
    return true;
  }

  accept(record, route) {
    this.#after = route;
    if (this.#request.phase === null || record.phase === this.#request.phase) {
      this.#records.push(record);
    }
  }

  finish(complete) {
    this.#complete = complete;
    return this;
  }

  get records() { return Object.freeze([...this.#records]); }
  get visitedNodes() { return this.#visited; }
  get after() { return this.#after; }
  get complete() { return this.#complete; }
}
