import ReservationRecordCodecPort, { RESERVATION_RECORD_MAX_BYTES } from '../../ports/ReservationRecordCodecPort.js';
import ReservationRecord from '../../domain/services/ReservationRecord.js';
import ReservationStorageError from '../../domain/errors/ReservationStorageError.js';
import { utf8Encode, utf8Decode } from '../../domain/encoding/utf8.js';

const FORMAT_VERSION = 1;
const FIELDS = 'binding,key,phase,preparation,settlement,version';

/** Exact canonical JSON boundary; extra fields and alternative encodings refuse. */
export default class ReservationRecordCodec extends ReservationRecordCodecPort {
  encode(record) {
    if (!(record instanceof ReservationRecord)) {
      throw new ReservationStorageError('Reservation encoding requires a validated record');
    }
    return utf8Encode(JSON.stringify({
      version: FORMAT_VERSION, key: record.key, binding: record.binding,
      phase: record.phase, preparation: record.preparation, settlement: record.settlement,
    }));
  }

  decode(bytes) {
    assertBytes(bytes);
    try {
      const value = JSON.parse(utf8Decode(bytes));
      assertEnvelope(value);
      const record = new ReservationRecord(value);
      const canonical = this.encode(record);
      if (canonical.length !== bytes.length || canonical.some((byte, i) => byte !== bytes[i])) {
        throw new ReservationStorageError('Reservation record is not canonically encoded');
      }
      return record;
    } catch (error) {
      if (error instanceof ReservationStorageError) {
        throw error;
      }
      throw new ReservationStorageError('Reservation record cannot be decoded', { originalError: error });
    }
  }
}

function assertBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > RESERVATION_RECORD_MAX_BYTES) {
    throw new ReservationStorageError('Reservation record must be at most 16 KiB of bytes');
  }
}

function assertEnvelope(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReservationStorageError('Reservation record must be an object');
  }
  if (value.version !== FORMAT_VERSION || Object.keys(value).sort().join(',') !== FIELDS) {
    throw new ReservationStorageError('Reservation record format or fields are invalid');
  }
}
