import ReservationNamespaceRegistry from '../../src/domain/services/ReservationNamespaceRegistry.js';
import ReservationCustodyCodec from '../../src/infrastructure/codecs/ReservationCustodyCodec.js';
import { reservationLedgerFixture } from './reservation-ledger.js';

export const RESERVATION_TEST_NAMESPACE = 'test/admission';
export const RESERVATION_TEST_BINDING = 'a'.repeat(64);

export function reservationNamespaceFixture() {
  const fixture = reservationLedgerFixture();
  const registry = new ReservationNamespaceRegistry({ ...fixture, custodyCodec: new ReservationCustodyCodec() });
  const open = (limit = 1) => registry.open({
    namespace: RESERVATION_TEST_NAMESPACE, capacity: { unit: 'record-slot', limit },
  });
  return { ...fixture, registry, open };
}
