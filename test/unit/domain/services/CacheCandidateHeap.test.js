import { describe, expect, it } from 'vitest';
import CacheCandidateHeap from '../../../../src/domain/services/CacheCandidateHeap.js';

describe('CacheCandidateHeap', () => {
  it('retains only the bounded oldest candidates with deterministic ties', () => {
    const heap = new CacheCandidateHeap(4);
    for (const [digest, sortKey] of [
      ['d', '2026-07-13T00:00:03.000Z'],
      ['b', '2026-07-13T00:00:02.000Z'],
      ['e', '2026-07-13T00:00:05.000Z'],
      ['a', '2026-07-13T00:00:01.000Z'],
      ['c', '2026-07-13T00:00:03.000Z'],
    ]) {
      heap.add({ digest, sortKey });
    }

    expect(heap.sorted().map(({ digest }) => digest)).toEqual(['a', 'b', 'c', 'd']);
  });
});
