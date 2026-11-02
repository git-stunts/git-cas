import ReservationCustodyCodecPort, { RESERVATION_CUSTODY_MAX_BYTES } from '../../ports/ReservationCustodyCodecPort.js';
import ReservationCustodyDescriptor from '../../domain/value-objects/ReservationCustodyDescriptor.js';
import ReservationEvidenceRoots from '../../domain/value-objects/ReservationEvidenceRoots.js';
import ReservationStorageError from '../../domain/errors/ReservationStorageError.js';
import { utf8Encode, utf8Decode } from '../../domain/encoding/utf8.js';

const FIELDS = 'binding,key,namespace,parents,preparation,recordOid,stage,supports,version';

/** Noncanonical encodings and extra fields never acquire custody meaning. */
export default class ReservationCustodyCodec extends ReservationCustodyCodecPort {
  encode(descriptor) {
    if (!(descriptor instanceof ReservationCustodyDescriptor)) {
      throw new ReservationStorageError('Custody encoding requires a validated descriptor');
    }
    const bytes = utf8Encode(JSON.stringify({
      version: 1, namespace: descriptor.namespace, key: descriptor.key, binding: descriptor.binding,
      stage: descriptor.stage, recordOid: descriptor.recordOid, preparation: descriptor.preparation,
      supports: descriptor.roots.supports.map(({ type, oid }) => ({ type, oid })), parents: descriptor.roots.parents,
    }));
    if (bytes.length > RESERVATION_CUSTODY_MAX_BYTES) {
      throw new ReservationStorageError('Custody descriptor exceeds 16 KiB');
    }
    return bytes;
  }

  decode(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length > RESERVATION_CUSTODY_MAX_BYTES) {
      throw new ReservationStorageError('Custody descriptor requires at most 16 KiB of bytes');
    }
    try {
      const value = JSON.parse(utf8Decode(bytes));
      assertEnvelope(value);
      const roots = new ReservationEvidenceRoots({ supports: value.supports, parents: value.parents });
      const descriptor = new ReservationCustodyDescriptor({ ...value, roots });
      const canonical = this.encode(descriptor);
      if (canonical.length !== bytes.length || canonical.some((byte, i) => byte !== bytes[i])) {
        throw new ReservationStorageError('Custody descriptor is not canonically encoded');
      }
      return descriptor;
    } catch (error) {
      if (error instanceof ReservationStorageError) {
        throw error;
      }
      throw new ReservationStorageError('Custody descriptor cannot be decoded', { originalError: error });
    }
  }
}

function assertEnvelope(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      value.version !== 1 || Object.keys(value).sort().join(',') !== FIELDS) {
    throw new ReservationStorageError('Custody descriptor format or fields are invalid');
  }
}
