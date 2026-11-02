import ReservationLedgerCodecPort, { RESERVATION_HEADER_MAX_BYTES } from '../../ports/ReservationLedgerCodecPort.js';
import ReservationPolicy from '../../domain/value-objects/ReservationPolicy.js';
import ReservationLedgerHeader from '../../domain/value-objects/ReservationLedgerHeader.js';
import ReservationStorageError from '../../domain/errors/ReservationStorageError.js';
import { utf8Encode, utf8Decode } from '../../domain/encoding/utf8.js';

const FORMAT_VERSION = 1;
const FIELDS = 'charged,limit,namespace,unit,version';

/** Strict canonical storage boundary. Unsupported policy cannot become empty. */
export default class ReservationLedgerCodec extends ReservationLedgerCodecPort {
  encode(header) {
    if (!(header instanceof ReservationLedgerHeader)) {
      throw new ReservationStorageError('Reservation ledger encoding requires a validated header');
    }
    const { namespace, unit, limit } = header.policy;
    return utf8Encode(JSON.stringify({ version: FORMAT_VERSION, namespace, unit, limit, charged: header.charged }));
  }

  decode(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length > RESERVATION_HEADER_MAX_BYTES) {
      throw new ReservationStorageError('Reservation ledger header must be at most 16 KiB');
    }
    try {
      const value = JSON.parse(utf8Decode(bytes));
      assertEnvelope(value);
      const policy = new ReservationPolicy({ namespace: value.namespace, capacity: { unit: value.unit, limit: value.limit } });
      const header = new ReservationLedgerHeader({ policy, charged: value.charged });
      const canonical = this.encode(header);
      if (canonical.length !== bytes.length || canonical.some((byte, i) => byte !== bytes[i])) {
        throw new ReservationStorageError('Reservation ledger header is not canonically encoded');
      }
      return header;
    } catch (error) {
      if (error instanceof ReservationStorageError) {
        throw error;
      }
      throw new ReservationStorageError('Reservation ledger header cannot be decoded', { originalError: error });
    }
  }
}

function assertEnvelope(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      value.version !== FORMAT_VERSION || Object.keys(value).sort().join(',') !== FIELDS) {
    throw new ReservationStorageError('Reservation ledger header format or fields are invalid');
  }
}
