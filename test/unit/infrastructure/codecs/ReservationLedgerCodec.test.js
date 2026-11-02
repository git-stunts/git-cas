import { describe, expect, it } from 'vitest';
import ReservationPolicy from '../../../../src/domain/value-objects/ReservationPolicy.js';
import ReservationLedgerHeader from '../../../../src/domain/value-objects/ReservationLedgerHeader.js';
import ReservationLedgerCodec from '../../../../src/infrastructure/codecs/ReservationLedgerCodec.js';
import { utf8Encode, utf8Decode } from '../../../../src/domain/encoding/utf8.js';

const policy = () => new ReservationPolicy({ namespace: 'test/admission', capacity: { unit: 'record-slot', limit: 3 } });

describe('Reservation namespace policy and header', () => {
  it('round-trips exact immutable policy and count', () => {
    const codec = new ReservationLedgerCodec();
    const header = new ReservationLedgerHeader({ policy: policy(), charged: 2 });
    const recovered = codec.decode(codec.encode(header));
    expect(recovered).toBeInstanceOf(ReservationLedgerHeader);
    expect(recovered.policy.equals(policy())).toBe(true);
    expect(recovered.charged).toBe(2);
    expect(Object.isFrozen(recovered)).toBe(true);
    expect(Object.isFrozen(recovered.policy)).toBe(true);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid limit %s', (limit) => {
    expect(() => new ReservationPolicy({ namespace: 'test', capacity: { unit: 'record-slot', limit } })).toThrowError();
  });

  it('never interprets a byte capacity as record slots', () => {
    expect(() => new ReservationPolicy({ namespace: 'test', capacity: { unit: 'bytes', limit: 3 } })).toThrowError();
  });

  it.each([-1, 4, 1.5, NaN, Infinity])('rejects invalid charge %s', (charged) => {
    expect(() => new ReservationLedgerHeader({ policy: policy(), charged })).toThrowError();
  });
});

describe('ReservationLedgerCodec corrupted storage', () => {
  it.each(['null', '{}', '{', ' '.repeat(16385)])('refuses malformed header %#', (text) => {
    expect(() => new ReservationLedgerCodec().decode(utf8Encode(text))).toThrowError();
  });

  it('refuses unknown fields, version and noncanonical encoding', () => {
    const codec = new ReservationLedgerCodec();
    const text = utf8Decode(codec.encode(new ReservationLedgerHeader({ policy: policy(), charged: 1 })));
    for (const modified of [` ${text}`, text.replace('"version":1', '"version":2'),
      text.replace('"charged":1', '"charged":1,"expired":true')]) {
      expect(() => codec.decode(utf8Encode(modified))).toThrowError();
    }
  });
});
