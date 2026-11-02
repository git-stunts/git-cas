import { describe, expect, it } from 'vitest';
import ReservationRecord from '../../../../src/domain/services/ReservationRecord.js';
import ReservationRecordCodec from '../../../../src/infrastructure/codecs/ReservationRecordCodec.js';
import { utf8Encode, utf8Decode } from '../../../../src/domain/encoding/utf8.js';

const codec = new ReservationRecordCodec();
const reserved = () => new ReservationRecord({ key: 'attempt', binding: 'a'.repeat(64), phase: 'reserved' });
const corrupt = expect.objectContaining({ code: 'RESERVATION_CORRUPT' });

describe('ReservationRecordCodec exact durable form', () => {
  it.each(['reserved', 'prepared', 'armed', 'settled', 'cancelled'])('round-trips %s as a validated frozen record', (phase) => {
    const records = {
      reserved: reserved(), prepared: reserved().prepare('a'.repeat(40)),
      armed: reserved().prepare('a'.repeat(40)).arm(),
      settled: reserved().prepare('a'.repeat(40)).settle('b'.repeat(40)),
      cancelled: reserved().prepare('a'.repeat(40)).cancel(),
    };
    const record = records[phase];
    const bytes = codec.encode(record);
    const decoded = codec.decode(bytes);
    expect(decoded).toBeInstanceOf(ReservationRecord);
    expect(decoded).toEqual(record);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(codec.encode(decoded)).toEqual(bytes);
  });

  it('refuses a plain shape at the encoding boundary', () => {
    expect(() => codec.encode({ ...reserved() })).toThrowError();
  });
});

describe('ReservationRecordCodec malformed storage', () => {
  it.each(['null', '[]', '{}', '{', ' '.repeat(16385)])('rejects malformed or oversized bytes %#', (text) => {
    expect(() => codec.decode(utf8Encode(text))).toThrowError(corrupt);
  });

  it.each([
    (s) => ` ${s}`,
    (s) => s.replace('"version":1', '"version":2'),
    (s) => s.replace('"key":"attempt"', '"key":"attempt","key":"attempt"'),
    (s) => s.replace('"phase":"reserved"', '"phase":"armed"'),
    (s) => s.replace('"key":"attempt"', '"key":"attempt","charge":0'),
  ])('rejects noncanonical, contradictory or extra fields %#', (change) => {
    const text = utf8Decode(codec.encode(reserved()));
    expect(() => codec.decode(utf8Encode(change(text)))).toThrowError(corrupt);
  });

  it('requires bytes, not a string or arbitrary object', () => {
    for (const value of [null, {}, 'text']) {
      expect(() => codec.decode(value)).toThrowError(corrupt);
    }
  });
});
