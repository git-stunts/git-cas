import { describe, expect, it, vi } from 'vitest';
import { reservationNamespaceFixture, RESERVATION_TEST_BINDING as binding } from '../../../helpers/reservation-namespace.js';

async function populated(count = 72) {
  const f = reservationNamespaceFixture();
  const set = await f.open(count + 1);
  for (let i = 0; i < count; i++) {
    expect((await set.reserve({ key: `attempt-${i}`, binding })).status).toBe('admitted');
  }
  return { ...f, set };
}

async function collect(set, first, checkPage) {
  const records = [];
  let page = first;
  for (let i = 0; i < 150; i++) {
    expect(page.status).toBe('page');
    checkPage(page);
    records.push(...page.records);
    if (page.next === null) {
      return records;
    }
    const cursor = JSON.parse(JSON.stringify(page.next));
    page = await set.list({ cursor, nodeBudget: 129 });
  }
  throw new Error('Pagination did not terminate within the finite witness');
}

describe('bounded snapshot reservation listing', () => {
  it('lists more than64 records without duplicates and excludes later admissions from the cursor snapshot', async () => {
    const { set } = await populated();
    const first = await set.list({ limit: 2, nodeBudget: 129 });
    expect(first.next).not.toBeNull();
    await set.reserve({ key: 'later', binding });
    const records = await collect(set, first, (page) => {
      expect(page.revision).toBe(first.revision);
      expect(page.charged).toBe(72);
      expect(page.visitedNodes).toBeLessThanOrEqual(129);
    });
    expect(records).toHaveLength(72);
    expect(new Set(records.map((x) => x.key)).size).toBe(72);
    expect(records.some((x) => x.key === 'later')).toBe(false);
  });

  it('returns empty filtered pages with progress and counts seeking reads within the budget', async () => {
    const { set, persistence } = await populated(10);
    const trees = vi.spyOn(persistence, 'readTree');
    const blobs = vi.spyOn(persistence, 'readBlob');
    const first = await set.list({ phase: 'armed', nodeBudget: 129 });
    expect(first.records).toEqual([]);
    expect(first.next).not.toBeNull();
    expect(trees.mock.calls.length + blobs.mock.calls.length).toBe(first.visitedNodes + 2);
    let after = null;
    const records = await collect(set, first, (page) => {
      expect(page.records).toEqual([]);
      expect(page.visitedNodes).toBeLessThanOrEqual(129);
      if (page.next !== null) {
        expect(page.next.phase).toBe('armed');
        expect(page.next.after).not.toBe(after);
        after = page.next.after;
      }
    });
    expect(records).toEqual([]);
  });
});

describe('reservation cursor failures', () => {
  it('refuses an unavailable cursor snapshot instead of starting from the current head', async () => {
    const { set, refs } = await populated(3);
    const first = await set.list({ limit: 1 });
    await set.cancel({ key: 'attempt-0', binding });
    const resolve = refs.resolveTree.bind(refs);
    const missing = new Error('snapshot collected');
    vi.spyOn(refs, 'resolveTree').mockImplementation((oid) => oid === first.revision ? Promise.reject(missing) : resolve(oid));
    expect(await set.list({ cursor: first.next })).toMatchObject({ status: 'unavailable', cursor: first.next, cause: missing });
    expect(await set.list()).toMatchObject({ status: 'page', charged: 2 });
  });

  it('rejects cursor rebinding and invalid budgets before visiting storage', async () => {
    const { set, refs } = await populated(2);
    const { next } = await set.list({ limit: 1, phase: 'reserved' });
    const observe = vi.spyOn(refs, 'inspectRef');
    const inputs = [{ cursor: next, phase: 'armed' }, { cursor: { ...next, namespace: 'other' } },
      { limit: 101 }, { limit: 0 }, { nodeBudget: 128 }, { nodeBudget: 8193 }, { phase: 'expired' }];
    for (const options of inputs) {
      await expect(set.list(options)).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    }
    expect(observe).not.toHaveBeenCalled();
  });
});

describe('reservation ledger listing semantics', () => {
  it('returns terminal tombstones and frozen phase-filtered records', async () => {
    const { set } = await populated(3);
    await set.cancel({ key: 'attempt-1', binding });
    const page = await set.list({ phase: 'cancelled' });
    expect(page.records.map((x) => x.key)).toEqual(['attempt-1']);
    expect(page.records[0].charge).toBe(0);
    expect(Object.isFrozen(page.records)).toBe(true);
    expect(Object.isFrozen(page.records[0])).toBe(true);
    expect(page.charged).toBe(2);
  });
});
