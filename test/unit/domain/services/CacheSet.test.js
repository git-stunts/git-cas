import { describe, expect, it } from 'vitest';
import BundleService from '../../../../src/domain/services/BundleService.js';
import CacheSetRegistry from '../../../../src/domain/services/CacheSetRegistry.js';
import PageService from '../../../../src/domain/services/PageService.js';
import parseApplicationHandle from '../../../../src/domain/value-objects/ApplicationHandle.js';
import CacheHit from '../../../../src/domain/value-objects/CacheHit.js';
import RetentionWitness from '../../../../src/domain/value-objects/RetentionWitness.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import MemoryPersistenceAdapter from '../../../helpers/MemoryPersistenceAdapter.js';
import MemoryRefAdapter from '../../../helpers/MemoryRefAdapter.js';

function makeServices(policy) {
  let time = Date.parse('2026-07-13T12:00:00.000Z');
  let resolutionCount = 0;
  const clock = { now: () => new Date(time) };
  const persistence = new MemoryPersistenceAdapter();
  const ref = new MemoryRefAdapter();
  const pages = new PageService({ persistence, clock });
  const services = {};
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
    crypto: new NodeCryptoAdapter(),
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
    get resolutionCount() { return resolutionCount; },
    advance: (milliseconds) => { time += milliseconds; },
  };
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
