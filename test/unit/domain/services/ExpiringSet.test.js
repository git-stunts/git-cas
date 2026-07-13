import { describe, expect, it } from 'vitest';
import { CasError, ErrorCodes } from '../../../../src/domain/errors/index.js';
import BundleService from '../../../../src/domain/services/BundleService.js';
import ExpiringSet from '../../../../src/domain/services/ExpiringSet.js';
import ExpiringSetIndex, {
  EXPIRING_SET_STATE_PATH,
  markerPath,
} from '../../../../src/domain/services/ExpiringSetIndex.js';
import ExpiringSetMetadataCodec, {
  createExpiringSetState,
} from '../../../../src/domain/services/ExpiringSetMetadataCodec.js';
import ExpiringSetRegistry from '../../../../src/domain/services/ExpiringSetRegistry.js';
import PageService from '../../../../src/domain/services/PageService.js';
import RootSet from '../../../../src/domain/services/RootSet.js';
import RootSetMetadataCodec from '../../../../src/domain/services/RootSetMetadataCodec.js';
import RootSetPersistence from '../../../../src/domain/services/RootSetPersistence.js';
import parseApplicationHandle from '../../../../src/domain/value-objects/ApplicationHandle.js';
import ExpiringMarker from '../../../../src/domain/value-objects/ExpiringMarker.js';
import ExpiringSetRef from '../../../../src/domain/value-objects/ExpiringSetRef.js';
import RetentionWitness from '../../../../src/domain/value-objects/RetentionWitness.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import MemoryPersistenceAdapter from '../../../helpers/MemoryPersistenceAdapter.js';
import MemoryRefAdapter from '../../../helpers/MemoryRefAdapter.js';

const DEFAULT_NAMESPACE = 'git-warp/replay';

function makeBundles({ persistence, pages, clock }) {
  const services = {};
  const resolveHandle = async (value, context) => {
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
  return services.bundles;
}

function makeRootSet({ namespace, persistence, ref }) {
  const rootRef = ExpiringSetRef.forNamespace(namespace).toString();
  const metadataCodec = new RootSetMetadataCodec({ refType: ExpiringSetRef });
  const rootPersistence = new RootSetPersistence({
    rootSetRef: rootRef,
    persistence,
    ref,
    refType: ExpiringSetRef,
    metadataCodec,
  });
  return new RootSet({
    ref: rootRef,
    persistence: rootPersistence,
    refType: ExpiringSetRef,
    metadataCodec,
  });
}

function makeServices({ crypto = new NodeCryptoAdapter() } = {}) {
  let time = Date.parse('2026-07-13T12:00:00.000Z');
  const clock = { now: () => new Date(time) };
  const persistence = new MemoryPersistenceAdapter();
  const ref = new MemoryRefAdapter();
  const pages = new PageService({ persistence, clock });
  const bundles = makeBundles({ persistence, pages, clock });
  const registry = new ExpiringSetRegistry({
    persistence,
    ref,
    bundles,
    pages,
    crypto,
    clock,
  });
  const rootSet = (namespace = DEFAULT_NAMESPACE) => makeRootSet({
    namespace,
    persistence,
    ref,
  });
  return {
    clock,
    crypto,
    pages,
    persistence,
    ref,
    bundles,
    registry,
    rootSet,
    open: (namespace = DEFAULT_NAMESPACE) => registry.open({ namespace }),
    advance: (milliseconds) => { time += milliseconds; },
    rewind: (milliseconds) => { time -= milliseconds; },
  };
}

function future(clock, milliseconds = 60_000) {
  return new Date(clock.now().getTime() + milliseconds);
}

async function stageIndex(services, { summary, markers = [] }) {
  const codec = new ExpiringSetMetadataCodec();
  const state = createExpiringSetState({
    namespace: DEFAULT_NAMESPACE,
    summary,
    previous: null,
    now: services.clock.now().toISOString(),
  });
  const statePage = await services.pages.put({ source: codec.encodeState(state) });
  return await services.bundles.putOrderedReferences({
    members: [[EXPIRING_SET_STATE_PATH, statePage.handle], ...markers],
  });
}

describe('ExpiringSet admission', () => {
  it('anchors a digest-only marker and keeps contains non-mutating', async () => {
    const { clock, open, pages, ref } = makeServices();
    const set = open();
    const result = await set.addIfAbsent('nonce:secret-value', {
      expiresAt: future(clock),
    });
    const head = await ref.resolveRef(set.ref);
    const markerBytes = await pages.get({ handle: result.marker.evidence.handle });
    const persisted = Buffer.from(markerBytes).toString('utf8');

    expect(result).toMatchObject({ changed: true, admitted: true, generation: head });
    expect(result.marker).toBeInstanceOf(ExpiringMarker);
    expect(result.witness).toBeInstanceOf(RetentionWitness);
    expect(result.witness.root).toMatchObject({
      kind: 'expiring-set',
      namespace: DEFAULT_NAMESPACE,
      generation: head,
    });
    expect(persisted).not.toContain('nonce:secret-value');
    await expect(set.contains('nonce:secret-value')).resolves.toBe(true);
    await expect(ref.resolveRef(set.ref)).resolves.toBe(head);
  });

  it('returns the existing live marker without staging duplicate objects', async () => {
    const { clock, open, persistence } = makeServices();
    const set = open();
    const first = await set.addIfAbsent('same', { expiresAt: future(clock) });
    const before = { blobs: persistence.blobCount, trees: persistence.treeCount };
    const duplicate = await set.addIfAbsent('same', {
      expiresAt: future(clock, 120_000),
    });

    expect(duplicate).toMatchObject({ changed: false, admitted: false });
    expect(duplicate.marker.toJSON()).toEqual(first.marker.toJSON());
    expect(persistence.blobCount).toBe(before.blobs);
    expect(persistence.treeCount).toBe(before.trees);
  });
});

describe('ExpiringSet admission guards', () => {
  it('re-admits a marker only after its previous window expires', async () => {
    const { advance, clock, open } = makeServices();
    const set = open();
    const first = await set.addIfAbsent('reusable', { expiresAt: future(clock, 1000) });
    advance(1001);
    const second = await set.addIfAbsent('reusable', { expiresAt: future(clock, 2000) });

    expect(second).toMatchObject({ changed: true, admitted: true });
    expect(second.marker.generation).not.toBe(first.marker.generation);
    expect(second.marker.expiresAt).not.toBe(first.marker.expiresAt);
  });

  it('rejects invalid keys, expiry, add options, and eviction policy', async () => {
    const { clock, open, registry } = makeServices();
    const set = open();

    await expect(set.addIfAbsent('bad\u0000key', { expiresAt: future(clock) }))
      .rejects.toMatchObject({ code: 'EXPIRING_SET_KEY_INVALID' });
    await expect(set.addIfAbsent('expired', { expiresAt: clock.now() }))
      .rejects.toMatchObject({ code: 'EXPIRING_SET_MARKER_INVALID' });
    await expect(set.addIfAbsent('invalid-date', { expiresAt: new Date(Number.NaN) }))
      .rejects.toMatchObject({ code: 'EXPIRING_SET_MARKER_INVALID' });
    await expect(set.addIfAbsent('missing-options'))
      .rejects.toMatchObject({ code: 'EXPIRING_SET_MARKER_INVALID' });
    expect(() => registry.open({ namespace: 'git-warp/no-capacity', maxEntries: 1 }))
      .toThrow(expect.objectContaining({ code: 'INVALID_OPTIONS' }));
  });
});

describe('ExpiringSet expiry-only release', () => {
  it('treats expiry as a read-only miss and releases only on sweep', async () => {
    const { advance, clock, open, ref } = makeServices();
    const set = open();
    await set.addIfAbsent('short', { expiresAt: future(clock, 1000) });
    advance(1001);
    const head = await ref.resolveRef(set.ref);

    await expect(set.contains('short')).resolves.toBe(false);
    await expect(ref.resolveRef(set.ref)).resolves.toBe(head);
    await expect(set.sweep()).resolves.toMatchObject({ changed: true, removed: 1 });
    await expect(set.sweep()).resolves.toMatchObject({ changed: false, removed: 0 });
  });

  it('never removes live markers under arbitrary collection pressure', async () => {
    const { clock, open } = makeServices();
    const set = open();
    expect(set.remove).toBeUndefined();
    expect(set.repair).toBeUndefined();
    for (const key of ['one', 'two', 'three', 'four']) {
      await set.addIfAbsent(key, { expiresAt: future(clock) });
    }

    await expect(set.sweep()).resolves.toMatchObject({ changed: false, removed: 0 });
    await Promise.all(['one', 'two', 'three', 'four'].map(async (key) => {
      await expect(set.contains(key)).resolves.toBe(true);
    }));
  });

  it('extends protection when the injected clock rolls backward', async () => {
    const { advance, clock, open, rewind } = makeServices();
    const set = open();
    await set.addIfAbsent('rollback', { expiresAt: future(clock, 1000) });
    advance(900);
    rewind(500);

    await expect(set.contains('rollback')).resolves.toBe(true);
    await expect(set.sweep()).resolves.toMatchObject({ changed: false, removed: 0 });
  });
});

describe('ExpiringSet sweep retries', () => {
  it('rechecks a rolled-back clock after a conflict', async () => {
    const services = makeServices();
    const set = services.registry.open({
      namespace: DEFAULT_NAMESPACE,
      retry: { maxAttempts: 2, baseDelayMs: 0 },
    });
    await set.addIfAbsent('retry-rollback', {
      expiresAt: future(services.clock, 1000),
    });
    services.advance(1001);
    const updateRef = services.ref.updateRef.bind(services.ref);
    let conflicted = false;
    services.ref.updateRef = async (options) => {
      if (!conflicted) {
        conflicted = true;
        services.rewind(1001);
        throw new CasError('Injected ref conflict', ErrorCodes.GIT_ERROR, {
          expectedOldOid: options.expectedOldOid,
          actualOldOid: options.expectedOldOid,
        });
      }
      return await updateRef(options);
    };

    await expect(set.sweep()).resolves.toMatchObject({ changed: false, removed: 0 });
    expect(conflicted).toBe(true);
    await expect(set.contains('retry-rollback')).resolves.toBe(true);
  });
});

describe('ExpiringSet concurrent writers', () => {
  it('admits exactly one concurrent duplicate', async () => {
    const { clock, open } = makeServices();
    const left = open();
    const right = open();
    const results = await Promise.all([
      left.addIfAbsent('shared', { expiresAt: future(clock) }),
      right.addIfAbsent('shared', { expiresAt: future(clock) }),
    ]);

    expect(results.filter((result) => result.admitted)).toHaveLength(1);
    expect(results.filter((result) => result.changed)).toHaveLength(1);
    expect(results[0].marker.toJSON()).toEqual(results[1].marker.toJSON());
  });

  it('retries independent keys without losing either marker', async () => {
    const { clock, open } = makeServices();
    const left = open();
    const right = open();
    await Promise.all([
      left.addIfAbsent('left', { expiresAt: future(clock) }),
      right.addIfAbsent('right', { expiresAt: future(clock) }),
    ]);

    await expect(left.contains('left')).resolves.toBe(true);
    await expect(left.contains('right')).resolves.toBe(true);
  });
});

describe('ExpiringSet inspection and doctor', () => {
  it('reports bounded digest inventory and live/expired classification', async () => {
    const { advance, clock, open } = makeServices();
    const set = open();
    await set.addIfAbsent('short', { expiresAt: future(clock, 1000) });
    await set.addIfAbsent('long', { expiresAt: future(clock, 10_000) });
    advance(1001);
    const first = await set.inspect({ limit: 1 });
    const second = await set.inspect({ limit: 1, cursor: first.nextCursor });

    expect(first.markers).toHaveLength(1);
    expect(first.nextCursor).toMatch(/^[0-9a-f]{64}$/);
    expect(second.markers).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect([first.markers[0].status, second.markers[0].status].sort())
      .toEqual(['expired', 'live']);
    expect(first.markers[0]).not.toHaveProperty('verificationDigest');
    await expect(set.doctor()).resolves.toMatchObject({
      healthy: true,
      observed: { entryCount: 2, liveEntries: 1, expiredEntries: 1 },
    });
    expect(Object.isFrozen((await set.doctor()).issues)).toBe(true);
  });

  it('reports a missing nested marker page without mutating the ref', async () => {
    const { clock, open, persistence, ref } = makeServices();
    const set = open();
    const result = await set.addIfAbsent('missing', { expiresAt: future(clock) });
    const head = await ref.resolveRef(set.ref);
    persistence.deleteObject(result.marker.evidence.handle.oid);

    const report = await set.doctor();
    expect(report).toMatchObject({ healthy: false });
    expect(report.issues[0].code).toMatch(/NOT_FOUND|MISSING/);
    await expect(ref.resolveRef(set.ref)).resolves.toBe(head);
  });
});

describe('ExpiringSet doctor snapshots', () => {
  it('fails closed when the generation changes during inspection', async () => {
    const inspected = 'a'.repeat(40);
    const current = 'b'.repeat(40);
    const set = new ExpiringSet({
      namespace: DEFAULT_NAMESPACE,
      rootSet: {
        ref: ExpiringSetRef.forNamespace(DEFAULT_NAMESPACE).toString(),
        mutate: async () => {},
        doctor: async () => ({ healthy: true, headOid: inspected }),
        read: async () => ({ headOid: current, entries: [] }),
      },
      index: { scan: async () => ({}) },
      crypto: { sha256: async () => '0'.repeat(64) },
      clock: { now: () => new Date('2026-07-13T12:00:00.000Z') },
    });

    await expect(set.doctor()).resolves.toMatchObject({
      healthy: false,
      issues: [{
        code: 'EXPIRING_SET_CONFLICT',
        expectedGeneration: inspected,
        actualGeneration: current,
      }],
    });
  });
});

describe('ExpiringSet malformed-state doctor', () => {
  it('reports malformed marker metadata from an otherwise valid root', async () => {
    const services = makeServices();
    const set = services.open();
    const added = await set.addIfAbsent('malformed', { expiresAt: future(services.clock) });
    const index = new ExpiringSetIndex({
      bundles: services.bundles,
      pages: services.pages,
    });
    const malformed = await services.pages.put({ source: Buffer.from('{}') });
    const bundle = await stageIndex(services, {
      summary: {
        entryCount: 1,
        liveEntries: 1,
        expiredEntries: 0,
        nextExpiry: added.marker.expiresAt,
      },
      markers: [
        [markerPath(added.marker.keyDigest), malformed.handle],
      ],
    });
    await services.rootSet().replace({ entries: [index.toRootEntry(bundle.handle)] });

    const report = await set.doctor();
    expect(report).toMatchObject({ healthy: false });
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: 'EXPIRING_SET_MARKER_INVALID',
    }));
  });
});

describe('ExpiringSet mutation integrity gate', () => {
  it('refuses to heal a state page whose live marker edge is absent', async () => {
    const services = makeServices();
    const set = services.open();
    const expiresAt = future(services.clock).toISOString();
    const bundle = await stageIndex(services, {
      summary: {
        entryCount: 1,
        liveEntries: 1,
        expiredEntries: 0,
        nextExpiry: expiresAt,
      },
    });
    const index = new ExpiringSetIndex({
      bundles: services.bundles,
      pages: services.pages,
    });
    await services.rootSet().replace({ entries: [index.toRootEntry(bundle.handle)] });
    const head = await services.ref.resolveRef(set.ref);
    const objectCounts = {
      blobs: services.persistence.blobCount,
      trees: services.persistence.treeCount,
    };

    await expect(set.addIfAbsent('missing-edge', { expiresAt }))
      .rejects.toMatchObject({ code: 'EXPIRING_SET_STATE_INVALID' });
    await expect(set.sweep())
      .rejects.toMatchObject({ code: 'EXPIRING_SET_STATE_INVALID' });
    await expect(services.ref.resolveRef(set.ref)).resolves.toBe(head);
    expect(services.persistence.blobCount).toBe(objectCounts.blobs);
    expect(services.persistence.treeCount).toBe(objectCounts.trees);
    await expect(set.doctor()).resolves.toMatchObject({ healthy: false });
  });
});

describe('ExpiringSet collision verification', () => {
  it('rejects a crypto adapter that collapses the digest domains', async () => {
    const crypto = { sha256: () => '0'.repeat(64) };
    const { clock, open } = makeServices({ crypto });

    await expect(open().addIfAbsent('constant', { expiresAt: future(clock) }))
      .rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
  });

  it('fails closed when two keys share an index digest but not a verifier', async () => {
    const base = new NodeCryptoAdapter();
    const crypto = {
      sha256(bytes) {
        const input = Buffer.from(bytes).toString('utf8');
        return input.startsWith('git-cas:expiring-set:v1:index\u0000')
          ? '0'.repeat(64)
          : base.sha256(bytes);
      },
    };
    const { clock, open } = makeServices({ crypto });
    const set = open();
    await set.addIfAbsent('first', { expiresAt: future(clock) });

    await expect(set.contains('second'))
      .rejects.toMatchObject({ code: 'EXPIRING_SET_MARKER_INVALID' });
    await expect(set.addIfAbsent('second', { expiresAt: future(clock) }))
      .rejects.toMatchObject({ code: 'EXPIRING_SET_MARKER_INVALID' });
  });
});
