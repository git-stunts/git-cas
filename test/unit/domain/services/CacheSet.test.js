import { describe, expect, it, vi } from 'vitest';
import BundleService from '../../../../src/domain/services/BundleService.js';
import CacheIndex from '../../../../src/domain/services/CacheIndex.js';
import CacheSetRegistry from '../../../../src/domain/services/CacheSetRegistry.js';
import PageService from '../../../../src/domain/services/PageService.js';
import parseApplicationHandle from '../../../../src/domain/value-objects/ApplicationHandle.js';
import CacheHit from '../../../../src/domain/value-objects/CacheHit.js';
import RetentionWitness from '../../../../src/domain/value-objects/RetentionWitness.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import GitRefPort from '../../../../src/ports/GitRefPort.js';
import MemoryPersistenceAdapter from '../../../helpers/MemoryPersistenceAdapter.js';
import MemoryRefAdapter from '../../../helpers/MemoryRefAdapter.js';

function makeServices(policy, acquisitionCapabilities = {}) {
  let time = Date.parse('2026-07-13T12:00:00.000Z');
  let resolutionCount = 0;
  const clock = { now: () => new Date(time) };
  const persistence = new MemoryPersistenceAdapter();
  const ref = new MemoryRefAdapter();
  const pages = new PageService({ persistence, clock });
  const services = {};
  const crypto = acquisitionCrypto(ref, acquisitionCapabilities);
  const resolveHandle = async (value, context) => {
    resolutionCount += 1;
    const handle = parseApplicationHandle(value);
    if (handle.kind === 'page') {
      return await pages.resolveRoot(handle);
    }
    return await services.bundles.resolveRoot(handle, context);
  };
  services.bundles = new BundleService({
    persistence,
    codec: new JsonCodec(),
    pages,
    resolveHandle,
    openHandle: (handle) => pages.open({ handle }),
    clock,
  });
  const registry = new CacheSetRegistry({
    persistence,
    ref,
    bundles: services.bundles,
    pages,
    resolveHandle,
    crypto,
    clock,
  });
  const open = (override = policy) => registry.open({
    namespace: 'git-warp/materializations',
    policy: override,
  });
  return {
    clock,
    open,
    pages,
    persistence,
    ref,
    bundles: services.bundles,
    crypto,
    get resolutionCount() { return resolutionCount; },
    advance: (milliseconds) => { time += milliseconds; },
  };
}

function acquisitionCrypto(ref, {
  legacyRefCapabilities = false,
  legacyCryptoCapabilities = false,
}) {
  const crypto = new NodeCryptoAdapter();
  if (legacyRefCapabilities) {
    for (const method of ['anchorRef', 'deleteRef', 'iterateRefs']) {
      Object.defineProperty(ref, method, { value: GitRefPort.prototype[method] });
    }
  }
  return legacyCryptoCapabilities ? { sha256: crypto.sha256.bind(crypto) } : crypto;
}

async function page(pages, value) {
  return (await pages.put({ source: Buffer.from(value) })).handle;
}

describe('CacheSet retention lifecycle', () => {
  it('anchors immutable hits and leaves get non-mutating', async () => {
    const { open, pages, ref } = makeServices();
    const cache = open();
    const stored = await cache.put('role:alice', await page(pages, 'admin'));
    const head = await ref.resolveRef(cache.ref);
    const hit = await cache.get('role:alice');

    expect(stored.hit).toBeInstanceOf(CacheHit);
    expect(stored.witness).toBeInstanceOf(RetentionWitness);
    expect(hit).toMatchObject({ key: 'role:alice', policy: 'evictable', logicalBytes: 5 });
    expect(hit.evidence.root).toMatchObject({
      kind: 'cache-set',
      namespace: 'git-warp/materializations',
      generation: head,
    });
    await expect(ref.resolveRef(cache.ref)).resolves.toBe(head);
  });

  it.each([
    [{ legacyRefCapabilities: true }, 'anchorRef'],
    [{ legacyCryptoCapabilities: true }, 'randomBytes'],
  ])('keeps existing cache operations available without acquisition capability %s', async (
    capabilities,
    missingCapability,
  ) => {
    const services = makeServices(undefined, capabilities);
    const cache = services.open();
    await cache.put('role:alice', await page(services.pages, 'admin'));

    await expect(cache.get('role:alice')).resolves.toMatchObject({
      key: 'role:alice',
      logicalBytes: 5,
    });
    await expect(cache.acquire('role:alice')).rejects.toMatchObject({
      code: 'CACHE_ACQUISITION_INVALID',
      meta: { capability: missingCapability },
    });
  });
});

describe('CacheSet bounded acquisition', () => {
  it('acquires a scoped generation anchor without resolving the target again', async () => {
    const services = makeServices();
    const cache = services.open();
    const handle = await page(services.pages, 'materialized');
    await cache.put('coordinate:42', handle);
    const resolutionsBeforeAcquire = services.resolutionCount;

    const acquisition = await cache.acquire('coordinate:42');

    expect(services.resolutionCount).toBe(resolutionsBeforeAcquire);
    expect(acquisition).toMatchObject({
      hit: {
        key: 'coordinate:42',
        handle,
        policy: 'evictable',
      },
      evidence: {
        handle,
        policy: 'pinned',
        reachability: 'anchored',
        root: {
          kind: 'cache-acquisition',
          namespace: 'git-warp/materializations',
        },
      },
    });
    await expect(services.ref.resolveRef(acquisition.evidence.root.ref))
      .resolves.toBe(acquisition.hit.generation);

    await cache.remove('coordinate:42');
    await expect(services.ref.resolveRef(acquisition.evidence.root.ref))
      .resolves.toBe(acquisition.hit.generation);
    await expect(acquisition.release()).resolves.toMatchObject({ changed: true });
    await expect(acquisition.release()).resolves.toMatchObject({ changed: false });
    await expect(services.ref.resolveRef(acquisition.evidence.root.ref))
      .rejects.toMatchObject({ code: 'GIT_REF_NOT_FOUND' });
  });
});

describe('CacheSet acquisition admission', () => {
  it('does not create an acquisition for an expired entry', async () => {
    const services = makeServices();
    const cache = services.open();
    const anchor = vi.spyOn(services.ref, 'anchorRef');
    await cache.put('expired', await page(services.pages, 'expired'), {
      expiresAt: new Date(services.clock.now().getTime() + 1000),
    });
    services.advance(1001);

    await expect(cache.acquire('expired')).resolves.toBeNull();
    expect(anchor).not.toHaveBeenCalled();
  });

  it('retries from a fresh cache generation when acquisition races replacement', async () => {
    const services = makeServices();
    const cache = services.open();
    const first = await page(services.pages, 'first');
    const second = await page(services.pages, 'second');
    await cache.put('shared', first);
    const anchor = services.ref.anchorRef.bind(services.ref);
    let raced = false;
    services.ref.anchorRef = async (options) => {
      if (!raced) {
        raced = true;
        await cache.replace('shared', second, { expectedHandle: first });
      }
      return await anchor(options);
    };

    const acquisition = await cache.acquire('shared');

    expect(raced).toBe(true);
    expect(acquisition.hit.handle).toEqual(second);
    await acquisition.release();
  });
});

describe('CacheSet acquisition release safety', () => {
  it('fails closed when checked release observes another generation', async () => {
    const services = makeServices();
    const cache = services.open();
    await cache.put('shared', await page(services.pages, 'first'));
    const acquisition = await cache.acquire('shared');
    const replacement = await cache.put('other', await page(services.pages, 'second'));
    await services.ref.updateRef({
      ref: acquisition.evidence.root.ref,
      newOid: replacement.generation,
      expectedOldOid: acquisition.hit.generation,
    });

    await expect(acquisition.release()).rejects.toMatchObject({
      code: 'CACHE_ACQUISITION_RELEASE_CONFLICT',
    });
    await expect(services.ref.resolveRef(acquisition.evidence.root.ref))
      .resolves.toBe(replacement.generation);
  });
});

describe('CacheSet acquisition inspection', () => {
  it('inspects and generation-check releases active acquisitions without exposing keys', async () => {
    const services = makeServices();
    const cache = services.open();
    await cache.put('private:coordinate', await page(services.pages, 'value'));
    const acquisition = await cache.acquire('private:coordinate');

    const inspection = await cache.inspectAcquisitions({ limit: 10 });

    expect(inspection).toMatchObject({
      namespace: 'git-warp/materializations',
      nextCursor: null,
      entries: [{
        id: acquisition.id,
        generation: acquisition.hit.generation,
        acquiredAt: acquisition.acquiredAt,
      }],
    });
    expect(inspection.entries[0]).not.toHaveProperty('key');
    await expect(cache.releaseAcquisition({
      id: acquisition.id,
      expectedGeneration: acquisition.hit.generation,
    })).resolves.toMatchObject({ changed: true });
    await expect(acquisition.release()).resolves.toMatchObject({ changed: false });
  });

  it('paginates active acquisitions with an opaque stable cursor', async () => {
    const services = makeServices();
    const cache = services.open();
    await cache.put('private:coordinate', await page(services.pages, 'value'));
    const acquisitions = [];
    for (let index = 0; index < 3; index += 1) {
      acquisitions.push(await cache.acquire('private:coordinate'));
      services.advance(1);
    }

    const first = await cache.inspectAcquisitions({ limit: 2 });
    const second = await cache.inspectAcquisitions({ limit: 2, cursor: first.nextCursor });

    expect(first.entries.map(({ id }) => id)).toEqual(acquisitions.slice(0, 2).map(({ id }) => id));
    expect(first.nextCursor).toBe(acquisitions[1].id);
    expect(second.entries.map(({ id }) => id)).toEqual([acquisitions[2].id]);
    expect(second.nextCursor).toBeNull();
    expect([...first.entries, ...second.entries].every((entry) => !('key' in entry))).toBe(true);

    await Promise.all(acquisitions.map((acquisition) => acquisition.release()));
  });
});

describe('CacheSet expiry and replacement', () => {
  it('keeps expired gets read-only and releases entries on sweep', async () => {
    const { advance, clock, open, pages, ref } = makeServices();
    const cache = open();
    const expiresAt = new Date(clock.now().getTime() + 1000);
    await cache.put('short', await page(pages, 'value'), { expiresAt });
    advance(1001);
    const head = await ref.resolveRef(cache.ref);

    await expect(cache.get('short')).resolves.toBeNull();
    await expect(ref.resolveRef(cache.ref)).resolves.toBe(head);
    await expect(cache.sweep()).resolves.toMatchObject({ changed: true, removed: 1 });
    await expect(cache.get('short')).resolves.toBeNull();
  });

  it('rejects writes that are already expired', async () => {
    const { clock, open, pages } = makeServices();
    const cache = open();

    await expect(cache.put('expired', await page(pages, 'value'), {
      expiresAt: clock.now(),
    })).rejects.toMatchObject({ code: 'CACHE_ENTRY_INVALID' });
    await expect(cache.get('expired')).resolves.toBeNull();
  });

  it('does not return or mutate an expired entry from touch', async () => {
    const { advance, clock, open, pages, ref } = makeServices();
    const cache = open();
    await cache.put('short', await page(pages, 'value'), {
      expiresAt: new Date(clock.now().getTime() + 1000),
    });
    advance(1001);
    const head = await ref.resolveRef(cache.ref);

    await expect(cache.touch('short')).resolves.toMatchObject({ changed: false, hit: null });
    await expect(ref.resolveRef(cache.ref)).resolves.toBe(head);
  });

});

describe('CacheSet replacement guards', () => {
  it('replaces only existing entries and supports expected-handle guards', async () => {
    const { open, pages } = makeServices();
    const cache = open();
    const first = await page(pages, 'first');
    const second = await page(pages, 'second');

    await expect(cache.replace('missing', first)).resolves.toMatchObject({ accepted: false });
    await expect(cache.put('missing', first, { expectedHandle: second }))
      .resolves.toMatchObject({ accepted: false, changed: false });
    await cache.put('key', first);
    await expect(cache.replace('key', second, { expectedHandle: second }))
      .resolves.toMatchObject({ accepted: false, changed: false });
    await expect(cache.replace('key', second, { expectedHandle: first }))
      .resolves.toMatchObject({ accepted: true, changed: true });
    expect((await cache.get('key')).handle.toString()).toBe(second.toString());
  });

  it('does not stage cache objects for a rejected guard', async () => {
    const { open, pages, persistence } = makeServices();
    const cache = open();
    const first = await page(pages, 'first');
    const second = await page(pages, 'second');
    await cache.put('key', first);
    const before = {
      blobs: persistence.blobCount,
      trees: persistence.treeCount,
    };

    await expect(cache.replace('key', second, { expectedHandle: second }))
      .resolves.toMatchObject({ accepted: false, changed: false });

    expect(persistence.blobCount).toBe(before.blobs);
    expect(persistence.treeCount).toBe(before.trees);
  });
});

describe('CacheSet capacity policy', () => {
  it('evicts the oldest live evictable entry within maxEntries', async () => {
    const { advance, open, pages } = makeServices({ maxEntries: 1 });
    const cache = open();
    await cache.put('old', await page(pages, 'old'));
    advance(1000);
    const result = await cache.put('new', await page(pages, 'new'));

    expect(result.policy).toMatchObject({ satisfied: true, entryCount: 1 });
    await expect(cache.get('old')).resolves.toBeNull();
    await expect(cache.get('new')).resolves.toBeInstanceOf(CacheHit);
  });

  it('enforces deterministic logical bytes independently per entry', async () => {
    const { advance, open, pages } = makeServices({ maxBytes: 4 });
    const cache = open();
    await cache.put('old', await page(pages, 'old'));
    advance(1000);
    const result = await cache.put('new', await page(pages, 'four'));

    expect(result.policy).toMatchObject({ satisfied: true, logicalBytes: 4, entryCount: 1 });
    await expect(cache.get('old')).resolves.toBeNull();
    await expect(cache.get('new')).resolves.toMatchObject({ logicalBytes: 4 });
  });

  it('reports unsatisfied capacity instead of evicting pinned entries', async () => {
    const { open, pages } = makeServices({ maxEntries: 1 });
    const cache = open();
    await cache.put('one', await page(pages, 'one'), { retention: 'pinned' });
    const result = await cache.put('two', await page(pages, 'two'), { retention: 'pinned' });

    expect(result.policy).toMatchObject({ satisfied: false, entryCount: 2, pinnedEntries: 2 });
    await expect(cache.get('one')).resolves.toBeInstanceOf(CacheHit);
    await expect(cache.get('two')).resolves.toBeInstanceOf(CacheHit);
  });

  it('persists a stricter policy even when pinned entries leave it unsatisfied', async () => {
    const services = makeServices();
    const original = services.open();
    await original.put('one', await page(services.pages, 'one'), { retention: 'pinned' });
    await original.put('two', await page(services.pages, 'two'), { retention: 'pinned' });
    const strict = services.open({ maxEntries: 1 });
    const swept = await strict.sweep();
    const inspection = await strict.inspect();

    expect(swept).toMatchObject({ changed: true, removed: 0, policy: { satisfied: false } });
    expect(inspection.state.policy.maxEntries).toBe(1);
  });
});

describe('CacheSet access and operations', () => {
  it('coalesces explicit touches and exposes bounded inspection', async () => {
    const { advance, open, pages } = makeServices({ accessResolutionMs: 1000 });
    const cache = open();
    await cache.put('key', await page(pages, 'value'));
    advance(500);
    await expect(cache.touch('key')).resolves.toMatchObject({ changed: false });
    advance(500);
    await expect(cache.touch('key')).resolves.toMatchObject({ changed: true });

    const inspection = await cache.inspect({ limit: 1 });
    expect(inspection.entries).toHaveLength(1);
    expect(inspection.observed).toMatchObject({ entryCount: 1, logicalBytes: 5 });
    await expect(cache.doctor()).resolves.toMatchObject({ healthy: true });
  });

  it('returns exact bounded inspection cursors', async () => {
    const { open, pages } = makeServices();
    const cache = open();
    await cache.put('one', await page(pages, '1'));
    await cache.put('two', await page(pages, '2'));

    const first = await cache.inspect({ limit: 1 });
    const second = await cache.inspect({ limit: 1, cursor: first.nextCursor });

    expect(first.entries).toHaveLength(1);
    expect(first.nextCursor).toMatch(/^[0-9a-f]{64}$/);
    expect(second.entries).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it('keeps inventory scans shallow and resolves only selected hits', async () => {
    const services = makeServices();
    const cache = services.open();
    await cache.put('key', await page(services.pages, 'value'));
    const afterPut = services.resolutionCount;

    await cache.inspect();
    await cache.sweep();
    expect(services.resolutionCount).toBe(afterPut);

    await cache.get('key');
    expect(services.resolutionCount).toBe(afterPut + 1);
  });

});

describe('CacheSet doctor and repair', () => {
  it('repairs an authoritative entry list into a healthy generation', async () => {
    const { open, pages } = makeServices();
    const cache = open();
    const handle = await page(pages, 'repair');

    await expect(cache.repair({ entries: [{ key: 'fixed', handle }] }))
      .resolves.toMatchObject({ repaired: true });
    expect((await cache.get('fixed')).handle.toString()).toBe(handle.toString());
    await expect(cache.doctor()).resolves.toMatchObject({ healthy: true });
  });

  it('repairs a malformed current head without trusting its metadata', async () => {
    const { open, pages, persistence, ref } = makeServices();
    const cache = open();
    await cache.put('before', await page(pages, 'before'));
    const current = await ref.resolveRef(cache.ref);
    const badTree = await persistence.writeTree([]);
    const badCommit = await ref.createCommit({ treeOid: badTree, parentOid: null, message: 'bad' });
    await ref.updateRef({ ref: cache.ref, newOid: badCommit, expectedOldOid: current });
    const repairedHandle = await page(pages, 'after');

    await expect(cache.doctor()).resolves.toMatchObject({ healthy: false });
    await cache.repair({ entries: [{ key: 'after', handle: repairedHandle }] });

    await expect(cache.doctor()).resolves.toMatchObject({ healthy: true });
    expect((await cache.get('after')).handle).toEqual(repairedHandle);
  });

  it('rejects duplicate authoritative repair keys', async () => {
    const { open, pages } = makeServices();
    const cache = open();
    const handle = await page(pages, 'duplicate');

    await expect(cache.repair({
      entries: [
        { key: 'same', handle },
        { key: 'same', handle },
      ],
    })).rejects.toMatchObject({ code: 'CACHE_ENTRY_INVALID' });
  });

});

describe('CacheSet malformed indexes', () => {
  it('rejects non-canonical entry bundles and non-bundle members', async () => {
    const { bundles, crypto, pages } = makeServices();
    const target = await page(pages, 'target');
    const malformedEntry = await bundles.put({
      members: { extra: target, meta: target, target },
    });
    const digest = '0'.repeat(64);
    const malformedIndex = await bundles.put({
      members: { '.cache/state': target, [`entries/${digest}`]: target },
    });
    const index = new CacheIndex({ bundles, pages, crypto });

    await expect(index.assertEntryShape(malformedEntry.handle))
      .rejects.toMatchObject({ code: 'CACHE_STATE_INVALID' });
    await expect(index.getEntry(malformedIndex.handle, digest))
      .rejects.toMatchObject({ code: 'CACHE_STATE_INVALID' });
  });
});

describe('CacheSet concurrent writers', () => {
  it('retries from the winning generation without losing either entry', async () => {
    const { open, pages } = makeServices();
    const left = open();
    const right = open();
    const [leftHandle, rightHandle] = await Promise.all([
      page(pages, 'left'),
      page(pages, 'right'),
    ]);

    await Promise.all([
      left.put('left', leftHandle),
      right.put('right', rightHandle),
    ]);

    await expect(left.get('left')).resolves.toBeInstanceOf(CacheHit);
    await expect(left.get('right')).resolves.toBeInstanceOf(CacheHit);
  });

  it('does not retain a successful result from a lost conditional retry', async () => {
    const { open, pages } = makeServices();
    const left = open();
    const right = open();
    const original = await page(pages, 'original');
    const leftHandle = await page(pages, 'left');
    const rightHandle = await page(pages, 'right');
    await left.put('shared', original);

    const results = await Promise.all([
      left.replace('shared', leftHandle, { expectedHandle: original }),
      right.replace('shared', rightHandle, { expectedHandle: original }),
    ]);

    expect(results.filter((result) => result.accepted)).toHaveLength(1);
    expect(results.filter((result) => result.changed)).toHaveLength(1);
    const stored = await left.get('shared');
    const accepted = results.find((result) => result.accepted);
    const rejected = results.find((result) => !result.accepted);
    expect(accepted.hit.handle).toEqual(stored.handle);
    expect(rejected.hit.handle).toEqual(stored.handle);
  });

});

describe('CacheSet concurrent removal', () => {
  it('reports only the winning attempt as a mutation', async () => {
    const { open, pages } = makeServices();
    const left = open();
    const right = open();
    await left.put('shared', await page(pages, 'shared'));

    const results = await Promise.all([
      left.remove('shared'),
      right.remove('shared'),
    ]);

    expect(results.filter((result) => result.changed)).toHaveLength(1);
    expect(results.filter((result) => result.removed)).toHaveLength(1);
    expect(results.filter((result) => result.witness)).toHaveLength(1);
  });
});
