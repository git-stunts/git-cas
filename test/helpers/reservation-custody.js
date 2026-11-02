import ReservationCustodyObjects from '../../src/domain/services/ReservationCustodyObjects.js';
import ReservationCustodyStore from '../../src/domain/services/ReservationCustodyStore.js';
import ReservationCustodyCodec from '../../src/infrastructure/codecs/ReservationCustodyCodec.js';

export function createReservationCustody({ namespace, persistence, refs, crypto }) {
  const objects = new ReservationCustodyObjects({ namespace, persistence, refs, codec: new ReservationCustodyCodec() });
  return { objects, custody: new ReservationCustodyStore({ objects, refs, crypto }) };
}
