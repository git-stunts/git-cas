import { describe, expect, it, vi } from 'vitest';
import AssetService from '../../../../src/domain/services/AssetService.js';
import CasService from '../../../../src/domain/services/CasService.js';
import AssetHandle from '../../../../src/domain/value-objects/AssetHandle.js';
import StagedAsset from '../../../../src/domain/value-objects/StagedAsset.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import MemoryPersistenceAdapter from '../../../helpers/MemoryPersistenceAdapter.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';

const OBSERVED_AT = '2026-07-13T10:00:00.000Z';
const testCrypto = await getTestCryptoAdapter();

function makeAssets({ concurrency = 1 } = {}) {
  const persistence = new MemoryPersistenceAdapter();
  const cas = new CasService({
    persistence,
    crypto: testCrypto,
    codec: new JsonCodec(),
    observability: new SilentObserver(),
    chunkSize: 1024,
    merkleThreshold: 2,
    concurrency,
    chunker: new FixedChunker({ chunkSize: 1024 }),
    compressionAdapter: new NodeCompressionAdapter(),
  });
  const assets = new AssetService({
    cas,
    clock: { now: () => new Date(OBSERVED_AT) },
  });
  return { assets, persistence };
}

async function* source(bytes, sourceChunkSize = 257) {
  for (let offset = 0; offset < bytes.length; offset += sourceChunkSize) {
    yield bytes.subarray(offset, offset + sourceChunkSize);
  }
}

async function collect(iterable) {
  const chunks = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

describe('AssetService put/open', () => {
  it('streams a payload through a staged handle round trip', async () => {
    const { assets } = makeAssets();
    const payload = Buffer.alloc(8 * 1024 + 17, 0x5a);

    const staged = await assets.put({
      source: source(payload),
      slug: 'large-state',
      filename: 'state.bin',
    });

    expect(staged).toBeInstanceOf(StagedAsset);
    expect(staged.handle).toBeInstanceOf(AssetHandle);
    expect(staged.handle.codec).toBe('json');
    expect(staged.asset.size).toBe(payload.length);
    expect(staged.retention).toEqual({
      policy: null,
      reachability: 'unanchored',
      protection: 'not-established',
    });
    expect(staged.observedAt).toBe(OBSERVED_AT);
    expect(staged).not.toHaveProperty('manifest');

    const opened = assets.open({ handle: staged.handle });
    expect(opened[Symbol.asyncIterator]).toBeTypeOf('function');
    await expect(collect(opened)).resolves.toEqual(payload);
  });

  it('adopts a validated existing manifest tree without repository identity', async () => {
    const { assets } = makeAssets();
    const staged = await assets.put({
      source: source(Buffer.from('adopt me')),
      slug: 'adopted',
      filename: 'adopted.txt',
    });

    const adopted = await assets.adopt({ treeOid: staged.handle.oid });

    expect(adopted.handle.toString()).toBe(staged.handle.toString());
    expect(adopted.asset).toEqual(staged.asset);
  });
});

describe('AssetService chunk graph validation', () => {
  it('validates unique chunk objects with bounded concurrency', async () => {
    const { assets, persistence } = makeAssets({ concurrency: 3 });
    const payload = Buffer.alloc(8 * 1024);
    for (let index = 0; index < 8; index++) {
      payload.fill(index, index * 1024, (index + 1) * 1024);
    }
    const staged = await assets.put({
      source: source(payload),
      slug: 'bounded-validation',
      filename: 'bounded.bin',
    });
    const readObjectType = persistence.readObjectType.bind(persistence);
    let active = 0;
    let maximum = 0;
    vi.spyOn(persistence, 'readObjectType').mockImplementation(async (oid) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await readObjectType(oid);
      } finally {
        active -= 1;
      }
    });

    await assets.resolveRoot(staged.handle);

    expect(maximum).toBe(3);
  });
});

describe('AssetService handle failures', () => {
  it('reports a missing transferred object graph explicitly', async () => {
    const { assets } = makeAssets();
    const handle = new AssetHandle({ codec: 'json', oid: 'f'.repeat(40) });

    await expect(collect(assets.open({ handle }))).rejects.toMatchObject({
      code: 'HANDLE_TARGET_MISSING',
      meta: { handle: handle.toString() },
    });
  });

  it('rejects an object with the wrong Git kind', async () => {
    const { assets, persistence } = makeAssets();
    const blobOid = await persistence.writeBlob(Buffer.from('not a tree'));
    const handle = new AssetHandle({ codec: 'json', oid: blobOid });

    await expect(assets.resolveRoot(handle)).rejects.toMatchObject({
      code: 'HANDLE_TARGET_TYPE_MISMATCH',
      meta: { actualType: 'blob', expectedType: 'tree' },
    });
  });

  it('rejects a handle for a different manifest codec', async () => {
    const { assets } = makeAssets();
    const staged = await assets.put({
      source: source(Buffer.from('codec')),
      slug: 'codec',
      filename: 'codec.txt',
    });
    const handle = new AssetHandle({ codec: 'cbor', oid: staged.handle.oid });

    await expect(assets.resolveRoot(handle)).rejects.toMatchObject({
      code: 'HANDLE_CODEC_MISMATCH',
      meta: { expectedCodec: 'json', actualCodec: 'cbor' },
    });
  });
});
