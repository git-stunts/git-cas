import { describe, expect, it } from 'vitest';
import { CasError, ErrorCodes } from '../../../../src/domain/errors/index.js';
import ReservationRecord from '../../../../src/domain/services/ReservationRecord.js';
import ReservationRefusal from '../../../../src/domain/value-objects/ReservationRefusal.js';

const KEY = 'observation-001';
const BINDING = 'a'.repeat(64);
const PREPARATION = 'b'.repeat(40);
const SETTLEMENT = 'c'.repeat(40);

function reserved() {
  return new ReservationRecord({ key: KEY, binding: BINDING, phase: 'reserved' });
}

function refusal(result, reason) {
  expect(result).toBeInstanceOf(ReservationRefusal);
  expect(result.reason).toBe(reason);
  expect(Object.isFrozen(result)).toBe(true);
}

describe('ReservationRecord local lifecycle laws', () => {
  it('makes cancellation win before any publication permission can be armed', () => {
    const before = reserved().prepare(PREPARATION);
    const cancelled = before.cancel();
    expect(cancelled.phase).toBe('cancelled');
    expect(cancelled.charge).toBe(0);
    expect(cancelled.preparation).toBe(PREPARATION);
    refusal(cancelled.arm(), 'cancelled');
    refusal(cancelled.prepare(PREPARATION), 'cancelled');
    refusal(cancelled.settle(SETTLEMENT), 'cancelled');
    expect(cancelled.cancel()).toBe(cancelled);
    expect(before.phase).toBe('prepared');
    expect(before.charge).toBe(1);
  });

  it('makes arming win irreversibly over a later cancellation', () => {
    const armed = reserved().prepare(PREPARATION).arm();
    expect(armed.phase).toBe('armed');
    expect(armed.charge).toBe(1);
    refusal(armed.cancel(), 'irreversible');
    refusal(armed.arm(), 'already-armed');
    expect(armed.preparation).toBe(PREPARATION);
  });

  it('cannot arm or settle a reservation whose original evidence is unprepared', () => {
    const record = reserved();
    refusal(record.arm(), 'not-prepared');
    refusal(record.settle(SETTLEMENT), 'not-prepared');
    expect(record.cancel().charge).toBe(0);
  });

});

describe('ReservationRecord settlement', () => {
  it.each([40, 64])('preserves original evidence through settlement with %i-character OIDs', (length) => {
    const preparation = 'd'.repeat(length);
    const settlement = 'e'.repeat(length);
    const first = reserved();
    const prepared = first.prepare(preparation);
    const armed = prepared.arm();
    const settled = armed.settle(settlement);
    expect(settled).toMatchObject({ key: KEY, binding: BINDING, phase: 'settled', preparation, settlement });
    expect(settled.charge).toBe(1);
    expect(settled.settle(settlement)).toBe(settled);
    expect(settled.prepare(preparation)).toBe(settled);
    refusal(settled.arm(), 'already-settled');
    refusal(settled.cancel(), 'irreversible');
    expect(first.preparation).toBeNull();
    expect(prepared.settlement).toBeNull();
    for (const record of [first, prepared, armed, settled]) {
      expect(Object.isFrozen(record)).toBe(true);
    }
  });

  it('lets a prepared read settle without granting external publication permission', () => {
    const result = reserved().prepare(PREPARATION).settle(SETTLEMENT);
    expect(result.phase).toBe('settled');
    expect(result.charge).toBe(1);
    refusal(result.arm(), 'already-settled');
  });

});

describe('ReservationRecord exact recovery', () => {
  it('recovers exact preparation but refuses a newer or conflicting one', () => {
    const prepared = reserved().prepare(PREPARATION);
    expect(prepared.prepare(PREPARATION)).toBe(prepared);
    refusal(prepared.prepare('d'.repeat(40)), 'preparation-mismatch');
    const armed = prepared.arm();
    expect(armed.prepare(PREPARATION)).toBe(armed);
    refusal(armed.prepare('d'.repeat(40)), 'preparation-mismatch');
  });

  it('never substitutes a second final record for an already settled attempt', () => {
    const settled = reserved().prepare(PREPARATION).settle(SETTLEMENT);
    refusal(settled.settle('e'.repeat(40)), 'settlement-mismatch');
    expect(settled.settlement).toBe(SETTLEMENT);
  });

  it('reconstructs cancelled tombstones without reviving their capacity charge', () => {
    for (const preparation of [null, PREPARATION]) {
      const restored = new ReservationRecord({ key: KEY, binding: BINDING, phase: 'cancelled', preparation });
      expect(restored.charge).toBe(0);
      refusal(restored.arm(), 'cancelled');
    }
  });
});

describe('ReservationRecord boundary invariants', () => {
  it.each(['', 'x'.repeat(129), 'two words', 'line\nfeed', 'zero\0byte', 'é', null, 1])(
    'rejects noncanonical attempt key %j', (key) => {
      expect(() => new ReservationRecord({ key, binding: BINDING, phase: 'reserved' }))
        .toThrow(expect.objectContaining({ code: ErrorCodes.INVALID_OPTIONS }));
    },
  );

  it.each(['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), null, 1])(
    'rejects noncanonical request binding %j', (binding) => {
      expect(() => new ReservationRecord({ key: KEY, binding, phase: 'reserved' })).toThrow(CasError);
    },
  );

});

describe('ReservationRecord durable shape', () => {
  it.each([
    { phase: 'unknown' }, { phase: 'indeterminate' }, { phase: null },
    { phase: 'reserved', preparation: PREPARATION },
    { phase: 'reserved', settlement: SETTLEMENT },
    { phase: 'prepared' }, { phase: 'armed' },
    { phase: 'prepared', preparation: PREPARATION, settlement: SETTLEMENT },
    { phase: 'armed', preparation: PREPARATION, settlement: SETTLEMENT },
    { phase: 'settled', preparation: PREPARATION },
    { phase: 'settled', settlement: SETTLEMENT },
    { phase: 'cancelled', settlement: SETTLEMENT },
    { phase: 'prepared', preparation: 'b'.repeat(39) },
    { phase: 'prepared', preparation: 'B'.repeat(40) },
    { phase: 'settled', preparation: PREPARATION, settlement: 'c'.repeat(64) },
  ])('refuses contradictory durable evidence %j', (evidence) => {
    expect(() => new ReservationRecord({ key: KEY, binding: BINDING, ...evidence })).toThrow(CasError);
  });

  it.each([null, false, [], 'reserved'])('rejects a non-record constructor input %j', (value) => {
    expect(() => new ReservationRecord(value)).toThrow(CasError);
  });

});

describe('ReservationRecord ownership and transition input', () => {
  it('does not retain a mutable constructor input', () => {
    const input = { key: KEY, binding: BINDING, phase: 'prepared', preparation: PREPARATION };
    const record = new ReservationRecord(input);
    input.phase = 'cancelled';
    input.preparation = 'f'.repeat(40);
    expect(record.phase).toBe('prepared');
    expect(record.preparation).toBe(PREPARATION);
    expect(record.charge).toBe(1);
  });

  it('validates transition evidence before constructing a new durable candidate', () => {
    expect(() => reserved().prepare('not-an-oid')).toThrow(CasError);
    expect(() => reserved().prepare(PREPARATION).settle('not-an-oid')).toThrow(CasError);
    expect(() => reserved().prepare(PREPARATION).settle('c'.repeat(64))).toThrow(CasError);
  });

  it('rejects invented refusal reason codes', () => {
    expect(() => new ReservationRefusal('success')).toThrow(CasError);
  });
});
