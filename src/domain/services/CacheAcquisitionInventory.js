import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import CacheAcquisitionRef from '../value-objects/CacheAcquisitionRef.js';
import Oid from '../value-objects/Oid.js';

export function createCacheAcquisitionInventory(detailLimit) {
  return {
    observed: 0,
    inspected: 0,
    healthy: true,
    detailLimit,
    entries: [],
    totals: {
      activeCount: 0,
      oldestAcquiredAt: null,
      newestAcquiredAt: null,
      maxAgeMs: 0,
    },
  };
}

export function recordCacheAcquisition(inventory, record, observedAt) {
  inventory.observed += 1;
  inventory.inspected += 1;
  inventory.totals.activeCount += 1;
  let entry;
  try {
    assertDirectRefEvidence(record);
    const acquisitionRef = CacheAcquisitionRef.from(record.ref);
    const ageMs = Date.parse(observedAt) - Date.parse(acquisitionRef.acquiredAt);
    if (!Number.isSafeInteger(ageMs) || ageMs < 0) {
      throw createCasError(
        'Cache acquisition time is later than repository inspection',
        ErrorCodes.CACHE_ACQUISITION_INVALID,
        { ref: record.ref, acquiredAt: acquisitionRef.acquiredAt, observedAt },
      );
    }
    entry = {
      id: acquisitionRef.id,
      namespace: acquisitionRef.namespace,
      generation: Oid.from(record.oid).toString(),
      acquiredAt: acquisitionRef.acquiredAt,
      ageMs,
      healthy: true,
      issues: [],
    };
    updateTotals(inventory.totals, entry);
  } catch (error) {
    inventory.healthy = false;
    entry = {
      ref: record.ref,
      generation: record.oid,
      healthy: false,
      issues: [{
        code: error?.code ?? ErrorCodes.CACHE_ACQUISITION_INVALID,
        message: error instanceof Error ? error.message : String(error),
      }],
    };
  }
  if (inventory.entries.length < inventory.detailLimit) {
    inventory.entries.push(entry);
  }
}

function assertDirectRefEvidence(record) {
  if (record.symref === undefined) {
    throw createCasError(
      'Cache acquisition direct-ref evidence is unavailable',
      ErrorCodes.CACHE_ACQUISITION_INVALID,
      { ref: record.ref },
    );
  }
  if (record.symref !== null) {
    throw createCasError(
      'Symbolic cache acquisition refs are unsafe',
      ErrorCodes.CACHE_ACQUISITION_INVALID,
      { ref: record.ref, symref: record.symref },
    );
  }
}

export function cacheAcquisitionGroup(inventory) {
  return {
    healthy: inventory.healthy,
    coverage: {
      observed: inventory.observed,
      inspected: inventory.inspected,
      detailed: inventory.entries.length,
      complete: inventory.observed === inventory.inspected,
    },
    totals: inventory.totals,
    entries: inventory.entries,
  };
}

function updateTotals(totals, entry) {
  totals.oldestAcquiredAt = earlier(totals.oldestAcquiredAt, entry.acquiredAt);
  totals.newestAcquiredAt = later(totals.newestAcquiredAt, entry.acquiredAt);
  totals.maxAgeMs = Math.max(totals.maxAgeMs, entry.ageMs);
}

function earlier(current, candidate) {
  return current === null || candidate < current ? candidate : current;
}

function later(current, candidate) {
  return current === null || candidate > current ? candidate : current;
}
