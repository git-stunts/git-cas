import { describe, expect, it, vi } from 'vitest';
import AssetService from '../../../../src/domain/services/AssetService.js';
import CasService from '../../../../src/domain/services/CasService.js';
import RetentionService from '../../../../src/domain/services/RetentionService.js';
import RootSetRegistry from '../../../../src/domain/services/RootSetRegistry.js';
import RetentionWitness from '../../../../src/domain/value-objects/RetentionWitness.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import MemoryPersistenceAdapter from '../../../helpers/MemoryPersistenceAdapter.js';
import MemoryRefAdapter from '../../../helpers/MemoryRefAdapter.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';

const OBSERVED_AT = '2026-07-13T10:00:00.000Z';
const ROOT_REF = 'refs/cas/rootsets/application-assets';
const testCrypto = await getTestCryptoAdapter();

function makeServices() {
  const persistence = new MemoryPersistenceAdapter();
  const ref = new MemoryRefAdapter();
  const cas = new CasService({
    persistence,
    crypto: testCrypto,
    codec: new JsonCodec(),
    observability: new SilentObserver(),
    chunkSize: 1024,
    merkleThreshold: 1000,
    chunker: new FixedChunker({ chunkSize: 1024 }),
    compressionAdapter: new NodeCompressionAdapter(),
  });
  const assets = new AssetService({ cas });
  const rootSets = new RootSetRegistry({ persistence, ref });
  const resolveRoot = vi.fn((handle) => assets.resolveRoot(handle));
  const retention = new RetentionService({
    rootSets,
    resolveRoot,
    clock: { now: () => new Date(OBSERVED_AT) },
  });
  return { assets, persistence, ref, resolveRoot, retention, rootSets };
}

async function* source(value) {
  yield Buffer.from(value);
}

async function stage(assets, value) {
  return await assets.put({
    source: source(value),
    slug: `asset-${value}`,
    filename: `${value}.txt`,
  });
}

describe('RetentionService', () => {
  it('retains an asset through the exact witnessed generation and path', async () => {
    const { assets, persistence, retention, rootSets } = makeServices();
    const staged = await stage(assets, 'one');

    const result = await retention.retain({
      handle: staged.handle,
      root: { ref: ROOT_REF, name: 'current-state' },
      policy: 'pinned',
    });

    expect(result.changed).toBe(true);
    expect(result.witness).toBeInstanceOf(RetentionWitness);
    expect(result.witness).toMatchObject({
      handle: staged.handle,
      policy: 'pinned',
      reachability: 'anchored',
      root: {
        kind: 'root-set',
        namespace: 'application-assets',
        ref: ROOT_REF,
        path: 'root-00000000',
      },
      observedAt: OBSERVED_AT,
    });

    const state = await rootSets.open({ ref: ROOT_REF }).read();
    const generationTree = await persistence.readTree(state.treeOid);
    const evidenceEdge = generationTree.find((entry) => entry.name === result.witness.root.path);
    expect(state.headOid).toBe(result.witness.root.generation);
    expect(evidenceEdge).toMatchObject({
      type: 'tree',
      oid: staged.handle.oid,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe('RetentionService root validation', () => {
  it('rejects a malformed root ref before resolving or mutating storage', async () => {
    const { assets, ref, resolveRoot, retention } = makeServices();
    const staged = await stage(assets, 'invalid-root');
    const updateRef = vi.spyOn(ref, 'updateRef');

    await expect(
      retention.retain({
        handle: staged.handle,
        root: { ref: 'refs/heads/main', name: 'current-state' },
      })
    ).rejects.toMatchObject({ code: 'ROOT_SET_REF_INVALID' });

    expect(resolveRoot).not.toHaveBeenCalled();
    expect(updateRef).not.toHaveBeenCalled();
  });
});

describe('RetentionService replacement', () => {
  it('atomically replaces the named root and returns a fresh witness', async () => {
    const { assets, retention, rootSets } = makeServices();
    const first = await stage(assets, 'first');
    const second = await stage(assets, 'second');
    const retained = await retention.retain({
      handle: first.handle,
      root: { ref: ROOT_REF, name: 'current-state' },
      policy: 'evictable',
    });

    const replaced = await retention.retain({
      handle: second.handle,
      root: { ref: ROOT_REF, name: 'current-state' },
      policy: 'evictable',
    });

    expect(replaced.changed).toBe(true);
    expect(replaced.witness.root.generation).not.toBe(retained.witness.root.generation);
    expect((await rootSets.open({ ref: ROOT_REF }).list())[0]).toMatchObject({
      name: 'current-state',
      oid: second.handle.oid,
      retention: 'evictable',
    });
  });

  it('returns current-generation evidence for an idempotent retain', async () => {
    const { assets, retention } = makeServices();
    const staged = await stage(assets, 'same');
    const options = {
      handle: staged.handle,
      root: { ref: ROOT_REF, name: 'same' },
      policy: 'pinned',
    };
    const first = await retention.retain(options);
    const second = await retention.retain(options);

    expect(second.changed).toBe(false);
    expect(second.witness.root.generation).toBe(first.witness.root.generation);
  });
});
