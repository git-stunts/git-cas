import InvalidOptionsError from '../errors/InvalidOptionsError.js';
import { utf8Encode } from '../encoding/utf8.js';

const KEY_PATTERN = /^[!-~]{1,128}$/u;
const ROUTE_PATTERN = /^[0-9a-f]{64}$/u;
const ROUTE_DOMAIN = 'git-cas/reservation-key/v1\0';
export const RESERVATION_ROUTE_DIGITS = 64;

/** Bounded caller identity, hashed with a versioned storage-route domain. */
export default class ReservationKey {
  constructor(value) {
    if (typeof value !== 'string' || !KEY_PATTERN.test(value)) {
      throw new InvalidOptionsError('Reservation key must be 1 to 128 printable ASCII bytes without spaces');
    }
    this.value = value;
    Object.freeze(this);
  }

  async route(crypto) {
    const digest = await crypto.sha256(utf8Encode(ROUTE_DOMAIN + this.value));
    if (typeof digest !== 'string' || !ROUTE_PATTERN.test(digest)) {
      throw new InvalidOptionsError('Reservation routing requires a canonical SHA-256 digest');
    }
    return digest;
  }
}
