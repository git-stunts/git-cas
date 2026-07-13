import { ErrorCodes } from '../errors/index.js';
import createCasError from '../errors/createCasError.js';
import { CACHE_SET_REF_PREFIX } from '../value-objects/CacheSetRef.js';
import { EXPIRING_SET_REF_PREFIX } from '../value-objects/ExpiringSetRef.js';
import { ROOT_SET_REF_PREFIX } from '../value-objects/RootSetRef.js';
import { VAULT_REF } from './VaultPersistence.js';

export const DEFAULT_REPOSITORY_GRACE_PERIOD_MS = 14 * 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_COLLECTIONS_PER_KIND = 100;
const MAX_COLLECTIONS_PER_KIND = 1_000;

/** Composes bounded, non-mutating repository and managed-collection evidence. */
export default class RepositoryDoctor {
  constructor({ repository, rootSets, caches, expiringSets, vault, clock }) {
    assertDependencies({ repository, rootSets, caches, expiringSets, vault });
    this.repository = repository;
    this.rootSets = rootSets;
    this.caches = caches;
    this.expiringSets = expiringSets;
    this.vault = vault;
    this.clock = clock ?? { now: () => new Date() };
    Object.freeze(this);
  }

  async doctor(options = {}) {
    const observedAt = this.#now();
    const policy = inspectionPolicy(options, observedAt);
    const limitations = baseLimitations();
    const { refs, usage } = await this.#inventoryUsage(policy.maxCollectionsPerKind, limitations);
    const objects = await this.#inventoryObjects(policy.expiresBefore);

    if (!objects.consistent) {
      limitations.push(
        limitation(
          'REPOSITORY_CHANGED_DURING_INSPECTION',
          'Object counts changed between streamed Git inventories; derived counts are unknown.'
        )
      );
    }
    addTruncationLimitations(refs, limitations);

    const healthy = objects.consistent && usageHealthy(usage);
    return deepFreeze({
      version: 1,
      healthy,
      observedAt,
      completedAt: this.#now(),
      policy: {
        gracePeriodMs: policy.gracePeriodMs,
        expiresBefore: policy.expiresBefore,
        maxCollectionsPerKind: policy.maxCollectionsPerKind,
      },
      repository: {
        objects: objects.report,
        roots: {
          refCount: refs.refCount,
          reflogsIncluded: true,
          reflogCount: null,
        },
        evidence: {
          anchoredInventory: 'refs-and-reflogs',
          prunableInspection: 'dry-run',
          mutatesRepository: false,
        },
      },
      usage,
      limitations,
    });
  }

  async #inventoryObjects(expiresBefore) {
    const total = { objectCount: 0, logicalBytes: 0, physicalBytes: 0 };
    for await (const object of this.repository.iterateObjects()) {
      total.objectCount += 1;
      total.logicalBytes += object.logicalBytes;
      total.physicalBytes += object.physicalBytes;
      assertSafeTotals(total);
    }

    const anchoredCount = await count(this.repository.iterateReachableObjectIds());
    const volatileCount = await count(this.repository.iteratePrunableObjects({ expiresBefore }));
    const anchoredPhysicalBytes = await this.repository.reachablePhysicalBytes();
    const unreachableCount = total.objectCount - anchoredCount;
    const orphanedCount = unreachableCount - volatileCount;
    const unreachablePhysicalBytes = total.physicalBytes - anchoredPhysicalBytes;
    const consistent = [unreachableCount, orphanedCount, unreachablePhysicalBytes].every(
      (value) => Number.isSafeInteger(value) && value >= 0
    );

    return {
      consistent,
      report: {
        total,
        anchored: { objectCount: anchoredCount, physicalBytes: anchoredPhysicalBytes },
        orphaned: {
          objectCount: consistent ? orphanedCount : null,
          physicalBytes: null,
        },
        volatile: { objectCount: volatileCount, physicalBytes: null },
        unreachable: {
          objectCount: consistent ? unreachableCount : null,
          physicalBytes: consistent ? unreachablePhysicalBytes : null,
        },
      },
    };
  }

  async #inventoryUsage(limit, limitations) {
    const result = usageInventory(limit);
    for await (const record of this.repository.iterateRefs()) {
      result.refCount += 1;
      if (record.ref.startsWith(CACHE_SET_REF_PREFIX)) {
        result.caches.observed += 1;
        recordCache(result.caches, await this.#inspectCache(record));
      } else if (record.ref.startsWith(ROOT_SET_REF_PREFIX)) {
        result.rootSets.observed += 1;
        recordRootSet(result.rootSets, await this.#inspectRootSet(record));
      } else if (record.ref.startsWith(EXPIRING_SET_REF_PREFIX)) {
        result.expiringSets.observed += 1;
        recordExpiringSet(result.expiringSets, await this.#inspectExpiringSet(record));
      } else if (record.ref === VAULT_REF) {
        result.vault = record;
      }
    }
    return {
      refs: result,
      usage: {
        caches: collectionGroup(result.caches),
        rootSets: collectionGroup(result.rootSets),
        expiringSets: collectionGroup(result.expiringSets),
        vault: await this.#inspectVault(result.vault, limitations),
      },
    };
  }

  async #inspectCache(record) {
    const namespace = record.ref.slice(CACHE_SET_REF_PREFIX.length);
    try {
      const cache = await this.caches.open({ namespace });
      return cacheUsage(record, namespace, await cache.doctor());
    } catch (error) {
      return unhealthyCacheUsage({ record, namespace, error });
    }
  }

  async #inspectRootSet(record) {
    try {
      const rootSet = await this.rootSets.open({ ref: record.ref });
      return rootSetUsage(record, await rootSet.doctor());
    } catch (error) {
      return unhealthyRootSetUsage({ record, error });
    }
  }

  async #inspectExpiringSet(record) {
    const namespace = record.ref.slice(EXPIRING_SET_REF_PREFIX.length);
    try {
      const expiringSet = await this.expiringSets.open({ namespace });
      return expiringSetUsage(record, namespace, await expiringSet.doctor());
    } catch (error) {
      return unhealthyExpiringSetUsage({ record, namespace, error });
    }
  }

  async #inspectVault(record, limitations) {
    if (record === null) {
      return {
        ref: VAULT_REF,
        present: false,
        healthy: true,
        generation: null,
        entryCount: 0,
        physicalBytes: null,
        privacy: null,
        reachability: null,
        issues: [],
      };
    }
    try {
      const metadata = await this.vault.getVaultMetadata();
      const privacy = Boolean(metadata?.privacy?.enabled);
      if (privacy) {
        limitations.push(
          limitation(
            'VAULT_ENTRY_COUNT_REQUIRES_KEY',
            'Privacy-mode vault entry count is unknown without caller-provided key material.'
          )
        );
        return healthyVault(record, { entryCount: null, privacy });
      }
      const state = await this.vault.readState();
      return healthyVault(record, { entryCount: state.entries.size, privacy });
    } catch (error) {
      return {
        ref: VAULT_REF,
        present: true,
        healthy: false,
        generation: record.oid,
        entryCount: null,
        physicalBytes: null,
        privacy: null,
        reachability: 'anchored',
        issues: [publicError(error)],
      };
    }
  }

  #now() {
    const value = this.clock.now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw createCasError(
        'Repository doctor clock must return a valid Date',
        ErrorCodes.REPOSITORY_INSPECTION_INVALID
      );
    }
    return value.toISOString();
  }
}

function inspectionPolicy(options, observedAt) {
  assertOptionsObject(options);
  const maxCollectionsPerKind = collectionLimit(options.maxCollectionsPerKind);
  if (options.expiresBefore !== undefined) {
    return explicitExpiryPolicy(options, maxCollectionsPerKind);
  }
  return gracePeriodPolicy(options, observedAt, maxCollectionsPerKind);
}

function assertOptionsObject(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw invalidOptions('Repository doctor options must be an object');
  }
}

function collectionLimit(value = DEFAULT_MAX_COLLECTIONS_PER_KIND) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_COLLECTIONS_PER_KIND) {
    throw invalidOptions(
      `maxCollectionsPerKind must be an integer from 1 to ${MAX_COLLECTIONS_PER_KIND}`
    );
  }
  return value;
}

function explicitExpiryPolicy(options, maxCollectionsPerKind) {
  if (options.gracePeriodMs !== undefined) {
    throw invalidOptions('expiresBefore and gracePeriodMs are mutually exclusive');
  }
  const parsed = new Date(options.expiresBefore);
  if (
    typeof options.expiresBefore !== 'string' ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== options.expiresBefore
  ) {
    throw invalidOptions('expiresBefore must be a canonical millisecond UTC timestamp');
  }
  return { expiresBefore: options.expiresBefore, gracePeriodMs: null, maxCollectionsPerKind };
}

function gracePeriodPolicy(options, observedAt, maxCollectionsPerKind) {
  const gracePeriodMs = options.gracePeriodMs ?? DEFAULT_REPOSITORY_GRACE_PERIOD_MS;
  if (!Number.isSafeInteger(gracePeriodMs) || gracePeriodMs < 0) {
    throw invalidOptions('gracePeriodMs must be a non-negative safe integer');
  }
  const expiresAt = new Date(Date.parse(observedAt) - gracePeriodMs);
  if (Number.isNaN(expiresAt.getTime())) {
    throw invalidOptions('gracePeriodMs exceeds the supported timestamp range');
  }
  return {
    expiresBefore: expiresAt.toISOString(),
    gracePeriodMs,
    maxCollectionsPerKind,
  };
}

function cacheUsage(record, namespace, report) {
  if (!report.state) {
    return cacheUsageWithoutState(record, namespace, report);
  }
  const { state } = report;
  const policy = report.policy ? report.policy.limits : state.policy;
  return {
    namespace,
    ref: record.ref,
    generation: rootGeneration(report, record.oid),
    healthy: report.healthy,
    entryCount: state.entryCount,
    logicalBytes: state.logicalBytes,
    physicalBytes: null,
    retention: {
      pinnedEntries: state.pinnedEntries,
      evictableEntries: state.evictableEntries,
    },
    reachability: 'anchored',
    age: {
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      oldestAccessedAt: state.oldestAccessedAt,
    },
    expiry: {
      expiredEntries: state.expiredEntries,
      nextExpiry: state.nextExpiry,
    },
    policy,
    issues: report.issues ?? [],
  };
}

function cacheUsageWithoutState(record, namespace, report) {
  const knownEmpty = report.healthy;
  return {
    namespace,
    ref: record.ref,
    generation: rootGeneration(report, record.oid),
    healthy: report.healthy,
    entryCount: knownEmpty ? 0 : null,
    logicalBytes: knownEmpty ? 0 : null,
    physicalBytes: null,
    retention: knownEmpty ? { pinnedEntries: 0, evictableEntries: 0 } : null,
    reachability: 'anchored',
    age: knownEmpty ? { createdAt: null, updatedAt: null, oldestAccessedAt: null } : null,
    expiry: knownEmpty ? { expiredEntries: 0, nextExpiry: null } : null,
    policy: null,
    issues: report.issues ?? [],
  };
}

function rootSetUsage(record, report) {
  const counts = report.policyCounts;
  return {
    ref: record.ref,
    generation: report.headOid ?? record.oid,
    healthy: report.healthy,
    entryCount: report.entryCount ?? null,
    physicalBytes: null,
    retention: counts ? { pinnedEntries: counts.pinned, evictableEntries: counts.evictable } : null,
    reachability: report.reachabilityCounts ?? null,
    issues: report.issues ?? errorIssues(report),
  };
}

function expiringSetUsage(record, namespace, report) {
  if (!report.state) {
    return expiringSetUsageWithoutState(record, namespace, report);
  }
  return {
    namespace,
    ref: record.ref,
    generation: rootGeneration(report, record.oid),
    healthy: report.healthy,
    entryCount: report.state.entryCount,
    physicalBytes: null,
    reachability: 'anchored',
    age: {
      createdAt: report.state.createdAt,
      updatedAt: report.state.updatedAt,
    },
    expiry: {
      liveEntries: report.observed.liveEntries,
      expiredEntries: report.observed.expiredEntries,
      nextExpiry: report.state.nextExpiry,
    },
    issues: report.issues ?? [],
  };
}

function expiringSetUsageWithoutState(record, namespace, report) {
  const knownEmpty = report.healthy;
  return {
    namespace,
    ref: record.ref,
    generation: rootGeneration(report, record.oid),
    healthy: report.healthy,
    entryCount: knownEmpty ? 0 : null,
    physicalBytes: null,
    reachability: 'anchored',
    age: knownEmpty ? { createdAt: null, updatedAt: null } : null,
    expiry: knownEmpty ? { liveEntries: 0, expiredEntries: 0, nextExpiry: null } : null,
    issues: report.issues ?? [],
  };
}

function rootGeneration(report, fallback) {
  return report.root?.headOid ?? fallback;
}

function errorIssues(report) {
  return report.error ? [report.error] : [];
}

async function count(iterable) {
  let result = 0;
  for await (const value of iterable) {
    void value;
    result += 1;
  }
  return result;
}

function collectionInventory(totals, detailLimit) {
  return { observed: 0, inspected: 0, healthy: true, totals, entries: [], detailLimit };
}

function usageInventory(detailLimit) {
  return {
    refCount: 0,
    caches: collectionInventory(
      {
        entryCount: 0,
        logicalBytes: 0,
        pinnedEntries: 0,
        evictableEntries: 0,
        expiredEntries: 0,
      },
      detailLimit
    ),
    rootSets: collectionInventory(
      { entryCount: 0, pinnedEntries: 0, evictableEntries: 0 },
      detailLimit
    ),
    expiringSets: collectionInventory(
      { entryCount: 0, liveEntries: 0, expiredEntries: 0 },
      detailLimit
    ),
    vault: null,
  };
}

function coverage(inventory) {
  return {
    observed: inventory.observed,
    inspected: inventory.inspected,
    detailed: inventory.entries.length,
    complete: inventory.observed === inventory.inspected,
  };
}

function recordCache(inventory, entry) {
  recordCollection(inventory, entry, {
    entryCount: entry.entryCount,
    logicalBytes: entry.logicalBytes,
    pinnedEntries: entry.retention?.pinnedEntries,
    evictableEntries: entry.retention?.evictableEntries,
    expiredEntries: entry.expiry?.expiredEntries,
  });
}

function recordRootSet(inventory, entry) {
  recordCollection(inventory, entry, {
    entryCount: entry.entryCount,
    pinnedEntries: entry.retention?.pinnedEntries,
    evictableEntries: entry.retention?.evictableEntries,
  });
}

function recordExpiringSet(inventory, entry) {
  recordCollection(inventory, entry, {
    entryCount: entry.entryCount,
    liveEntries: entry.expiry?.liveEntries,
    expiredEntries: entry.expiry?.expiredEntries,
  });
}

function recordCollection(inventory, entry, values) {
  inventory.inspected += 1;
  inventory.healthy &&= entry.healthy;
  for (const [key, value] of Object.entries(values)) {
    addKnown(inventory.totals, key, value);
  }
  if (inventory.entries.length < inventory.detailLimit) {
    inventory.entries.push(entry);
  }
}

function collectionGroup(inventory) {
  return {
    healthy: inventory.healthy,
    coverage: coverage(inventory),
    totals: inventory.totals,
    entries: inventory.entries,
  };
}

function addKnown(totals, key, value) {
  if (totals[key] === null) {
    return;
  }
  const next = totals[key] + value;
  totals[key] = Number.isSafeInteger(value) && Number.isSafeInteger(next) ? next : null;
}

function healthyVault(record, { entryCount, privacy }) {
  return {
    ref: VAULT_REF,
    present: true,
    healthy: true,
    generation: record.oid,
    entryCount,
    physicalBytes: null,
    privacy,
    reachability: 'anchored',
    issues: [],
  };
}

function usageHealthy(usage) {
  return (
    usage.caches.healthy &&
    usage.rootSets.healthy &&
    usage.expiringSets.healthy &&
    usage.vault.healthy
  );
}

function unhealthyBase({ record, namespace, error }) {
  return {
    ...(namespace === undefined ? {} : { namespace }),
    ref: record.ref,
    generation: record.oid,
    healthy: false,
    entryCount: null,
    physicalBytes: null,
    reachability: 'anchored',
    issues: [publicError(error)],
  };
}

function unhealthyCacheUsage(options) {
  return {
    ...unhealthyBase(options),
    logicalBytes: null,
    retention: null,
    age: null,
    expiry: null,
    policy: null,
  };
}

function unhealthyRootSetUsage(options) {
  return { ...unhealthyBase(options), retention: null };
}

function unhealthyExpiringSetUsage(options) {
  return { ...unhealthyBase(options), age: null, expiry: null };
}

function publicError(error) {
  return {
    code: error?.code ?? ErrorCodes.REPOSITORY_INSPECTION_INVALID,
    message: error instanceof Error ? error.message : String(error),
  };
}

function baseLimitations() {
  return [
    limitation(
      'SHARED_PHYSICAL_BYTES_UNATTRIBUTABLE',
      'Deduplicated Git objects cannot be assigned exactly to one cache, root set, or vault.'
    ),
    limitation(
      'PACKED_OBJECT_AGE_UNAVAILABLE',
      'Git prune dry-run reports loose candidates; packed unreachable object age is not observable.'
    ),
    limitation(
      'REFLOG_COUNT_UNAVAILABLE',
      'Reflogs participate in reachability, but this bounded report does not enumerate reflog entries.'
    ),
    limitation(
      'ALTERNATE_OBJECT_STORES_INCLUDED',
      'Git may include objects and bytes from configured alternate object stores.'
    ),
    limitation(
      'PACK_OVERHEAD_EXCLUDED',
      'Git object disk sizes exclude pack indexes, bitmaps, and other repository metadata.'
    ),
  ];
}

function addTruncationLimitations(refs, limitations) {
  for (const [kind, inventory] of [
    ['caches', refs.caches],
    ['rootSets', refs.rootSets],
    ['expiringSets', refs.expiringSets],
  ]) {
    if (inventory.observed > inventory.entries.length) {
      limitations.push({
        ...limitation(
          'COLLECTION_DETAILS_TRUNCATED',
          'Managed collection detail exceeded maxCollectionsPerKind.'
        ),
        kind,
        observed: inventory.observed,
        inspected: inventory.inspected,
        detailed: inventory.entries.length,
      });
    }
  }
}

function limitation(code, message) {
  return { code, message };
}

function assertSafeTotals(total) {
  if (!Object.values(total).every(Number.isSafeInteger)) {
    throw invalidOptions('Repository object totals exceed JavaScript safe integer bounds');
  }
}

function assertDependencies(value) {
  const checks = [
    [
      value.repository,
      [
        'iterateObjects',
        'iterateReachableObjectIds',
        'iteratePrunableObjects',
        'iterateRefs',
        'reachablePhysicalBytes',
      ],
    ],
    [value.rootSets, ['open']],
    [value.caches, ['open']],
    [value.expiringSets, ['open']],
    [value.vault, ['getVaultMetadata', 'readState']],
  ];
  if (
    checks.some(([target, methods]) =>
      methods.some((method) => typeof target?.[method] !== 'function')
    )
  ) {
    throw invalidOptions(
      'RepositoryDoctor requires complete repository and collection dependencies'
    );
  }
}

function invalidOptions(message) {
  return createCasError(message, ErrorCodes.REPOSITORY_INSPECTION_INVALID);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
