import { describe, expect, it } from 'vitest';
import ReservationCustodyCodec from '../../../../src/infrastructure/codecs/ReservationCustodyCodec.js';
import ReservationCustodyDescriptor from '../../../../src/domain/value-objects/ReservationCustodyDescriptor.js';
import ReservationEvidenceRoots from '../../../../src/domain/value-objects/ReservationEvidenceRoots.js';
import ReservationEvidence from '../../../../src/domain/value-objects/ReservationEvidence.js';
import { utf8Encode, utf8Decode } from '../../../../src/domain/encoding/utf8.js';

function descriptor() {
  return new ReservationCustodyDescriptor({
    namespace: 'test/admission', key: 'one', binding: 'a'.repeat(64), stage: 'preparation', recordOid: 'b'.repeat(40),
    roots: new ReservationEvidenceRoots({ supports: [{ type: 'tree', oid: 'c'.repeat(40) }], parents: ['d'.repeat(40)] }),
  });
}

describe('Bounded immutable reservation evidence', () => {
  it('owns its page bytes and returns copies', () => {
    const bytes = utf8Encode('original');
    const evidence = new ReservationEvidence({ record: bytes });
    bytes[0] = 0;
    const first = evidence.record;
    first[1] = 0;
    expect(utf8Decode(evidence.record)).toBe('original');
    expect(Object.isFrozen(evidence)).toBe(true);
  });

  it('rejects oversized pages and root lists before storage', () => {
    expect(() => new ReservationEvidence({ record: new Uint8Array(16 * 1024 * 1024 + 1) })).toThrowError();
    expect(() => new ReservationEvidenceRoots({ parents: Array(64).fill('a'.repeat(40)) })).toThrowError();
    expect(() => new ReservationEvidenceRoots({ supports: Array(65).fill({ type: 'blob', oid: 'a'.repeat(40) }) })).toThrowError();
  });

  it('rejects gitlinks, duplicate roots, noncanonical IDs and mixed formats', () => {
    expect(() => new ReservationEvidenceRoots({ supports: [{ type: 'commit', oid: 'a'.repeat(40) }] })).toThrowError();
    expect(() => new ReservationEvidenceRoots({ parents: ['a'.repeat(40), 'a'.repeat(40)] })).toThrowError();
    expect(() => new ReservationEvidenceRoots({ parents: ['A'.repeat(40)] })).toThrowError();
    expect(() => new ReservationEvidenceRoots({ parents: ['a'.repeat(64)] }).assertFormat('b'.repeat(40))).toThrowError();
  });
});

describe('Reservation custody canonical descriptor', () => {
  it('reconstructs immutable identity and real support edges', () => {
    const codec = new ReservationCustodyCodec();
    const recovered = codec.decode(codec.encode(descriptor()));
    expect(recovered).toBeInstanceOf(ReservationCustodyDescriptor);
    expect(recovered.equals(descriptor())).toBe(true);
    expect(Object.isFrozen(recovered.roots.supports[0])).toBe(true);
    expect(recovered.parents).toEqual(['d'.repeat(40)]);
  });

  it.each(['null', '{}', '{', ' '.repeat(16385)])('refuses malformed bytes %#', (text) => {
    expect(() => new ReservationCustodyCodec().decode(utf8Encode(text))).toThrowError();
  });

  it('rejects extra fields, version changes and alternative encoding', () => {
    const codec = new ReservationCustodyCodec();
    const text = utf8Decode(codec.encode(descriptor()));
    for (const altered of [` ${text}`, text.replace('"version":1', '"version":2'),
      text.replace('"type":"tree"', '"type":"tree","ignored":true')]) {
      expect(() => codec.decode(utf8Encode(altered))).toThrowError();
    }
  });
});
