import { describe, expect, it } from 'vitest';
import {
  cacheAcquisitionGroup,
  createCacheAcquisitionInventory,
  recordCacheAcquisition,
} from '../../../../src/domain/services/CacheAcquisitionInventory.js';
import CacheAcquisitionRef from '../../../../src/domain/value-objects/CacheAcquisitionRef.js';

const OBSERVED_AT = '2026-07-16T13:00:00.000Z';

function acquisitionRef(acquiredAt = '2026-07-16T12:00:00.000Z') {
  return CacheAcquisitionRef.create({
    namespace: 'git-warp/materializations',
    keyDigest: 'a'.repeat(64),
    acquiredAt,
    nonce: 'b'.repeat(32),
  }).toString();
}

describe('CacheAcquisitionInventory', () => {
  it('reports bounded healthy age evidence without original cache keys', () => {
    const inventory = createCacheAcquisitionInventory(1);
    recordCacheAcquisition(inventory, {
      ref: acquisitionRef(),
      oid: 'c'.repeat(40),
    }, OBSERVED_AT);

    expect(cacheAcquisitionGroup(inventory)).toMatchObject({
      healthy: true,
      coverage: { observed: 1, inspected: 1, detailed: 1, complete: true },
      totals: {
        activeCount: 1,
        oldestAcquiredAt: '2026-07-16T12:00:00.000Z',
        newestAcquiredAt: '2026-07-16T12:00:00.000Z',
        maxAgeMs: 3_600_000,
      },
      entries: [{
        namespace: 'git-warp/materializations',
        ageMs: 3_600_000,
        healthy: true,
      }],
    });
    expect(JSON.stringify(inventory)).not.toContain('private-cache-key');
  });

  it.each([
    ['malformed ref', 'refs/cas/cache-acquisitions/broken', 'c'.repeat(40)],
    ['malformed generation', acquisitionRef(), 'not-an-oid'],
    ['future acquisition', acquisitionRef('2026-07-16T14:00:00.000Z'), 'c'.repeat(40)],
  ])('marks %s unhealthy without aborting inventory', (_name, ref, oid) => {
    const inventory = createCacheAcquisitionInventory(1);
    recordCacheAcquisition(inventory, { ref, oid }, OBSERVED_AT);

    expect(cacheAcquisitionGroup(inventory)).toMatchObject({
      healthy: false,
      coverage: { observed: 1, inspected: 1, detailed: 1, complete: true },
      totals: { activeCount: 1 },
      entries: [{ healthy: false, issues: [{ code: expect.any(String) }] }],
    });
  });
});
