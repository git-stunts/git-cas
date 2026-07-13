import { describe, expect, it, vi } from 'vitest';
import BundleService from '../../../../src/domain/services/BundleService.js';
import PageService from '../../../../src/domain/services/PageService.js';
import parseApplicationHandle from '../../../../src/domain/value-objects/ApplicationHandle.js';
import BundleHandle from '../../../../src/domain/value-objects/BundleHandle.js';
import PageHandle from '../../../../src/domain/value-objects/PageHandle.js';
import StagedBundle from '../../../../src/domain/value-objects/StagedBundle.js';
import CborCodec from '../../../../src/infrastructure/codecs/CborCodec.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import MemoryPersistenceAdapter from '../../../helpers/MemoryPersistenceAdapter.js';

const OBSERVED_AT = '2026-07-13T11:00:00.000Z';

function makeServices({
  limits,
  maxPageSize = 4096,
  codec = new JsonCodec(),
  clock = { now: () => new Date(OBSERVED_AT) },
} = {}) {
  const persistence = new MemoryPersistenceAdapter();
  const pages = new PageService({
    persistence,
    maxPageSize,
    clock,
  });
  const services = {};
  const resolveHandle = async (value, context) => {
    const handle = parseApplicationHandle(value);
    if (handle.kind === 'page') {
      return await pages.resolveRoot(handle);
    }
    if (handle.kind === 'bundle') {
      return await services.bundles.resolveRoot(handle, context);
    }
    throw new Error(`Unsupported test handle: ${handle.kind}`);
  };
  const openHandle = (value) => {
    const handle = parseApplicationHandle(value);
    if (handle.kind === 'page') {
      return pages.open({ handle });
    }
    throw new Error(`Unsupported test byte handle: ${handle.kind}`);
  };
  const bundles = new BundleService({
    persistence,
    codec,
    pages,
    resolveHandle,
    openHandle,
    limits,
    clock,
  });
  services.bundles = bundles;
  return { bundles, pages, persistence };
}

async function collect(source) {
  const chunks = [];
  for await (const chunk of source) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function rewriteBundleRoot(persistence, handle, mutate) {
  const descriptorEntry = await persistence.readTreeEntry(handle.oid, 'bundle.json');
  const indexEntry = await persistence.readTreeEntry(handle.oid, 'index');
  const codec = new JsonCodec();
  const descriptor = codec.decode(await persistence.readBlob(descriptorEntry.oid));
  mutate(descriptor);
  const descriptorOid = await persistence.writeBlob(codec.encode(descriptor));
  const oid = await persistence.writeTree([
    `100644 blob ${descriptorOid}\tbundle.json`,
    `040000 tree ${indexEntry.oid}\tindex`,
  ]);
  return new BundleHandle({ codec: 'json', oid });
}

describe('BundleService deterministic construction', () => {
  it('produces one stable handle and targeted members across object order', async () => {
    const { bundles } = makeServices();
    const first = await bundles.put({
      members: { 'z/final': Buffer.from('z'), 'a/first': Buffer.from('a') },
    });
    const second = await bundles.put({
      members: { 'a/first': Buffer.from('a'), 'z/final': Buffer.from('z') },
    });

    expect(first).toBeInstanceOf(StagedBundle);
    expect(first.handle).toBeInstanceOf(BundleHandle);
    expect(second.handle.toString()).toBe(first.handle.toString());
    expect(first.bundle).toMatchObject({ memberCount: 2, indexDepth: 1 });
    expect(first.retention.protection).toBe('not-established');

    const member = await bundles.getMember({ handle: first.handle, path: 'a/first' });
    expect(member.handle).toBeInstanceOf(PageHandle);
    await expect(collect(bundles.openMember({ handle: first.handle, path: 'a/first' })))
      .resolves.toEqual(Buffer.from('a'));
    await expect(bundles.getMember({ handle: first.handle, path: 'missing' })).resolves.toBeNull();
  });

  it('accepts nested bundle handles without pretending they are byte streams', async () => {
    const { bundles } = makeServices();
    const inner = await bundles.put({ members: { page: Buffer.from('inner') } });
    const outer = await bundles.put({ members: { nested: inner.handle } });

    const member = await bundles.getMember({ handle: outer.handle, path: 'nested' });

    expect(member.handle).toEqual(inner.handle);
    await expect(bundles.resolveRoot(outer.handle)).resolves.toMatchObject({ memberCount: 1 });
    await expect(collect(bundles.openMember({ handle: outer.handle, path: 'nested' })))
      .rejects.toMatchObject({ code: 'BUNDLE_MEMBER_NOT_STREAMABLE' });
  });
});

describe('BundleService descriptor codecs', () => {
  it('round-trips bundles through the configured CBOR codec', async () => {
    const { bundles } = makeServices({ codec: new CborCodec() });
    const staged = await bundles.put({ members: { page: Buffer.from('cbor') } });

    expect(staged.handle.codec).toBe('cbor');
    await expect(collect(bundles.openMember({ handle: staged.handle, path: 'page' })))
      .resolves.toEqual(Buffer.from('cbor'));
  });
});

describe('BundleService bounded fanout', () => {
  it('bulk-loads ordered members without exceeding node width', async () => {
    const { bundles, persistence } = makeServices({
      limits: { maxFanoutEntries: 4, maxFanoutDepth: 5 },
    });
    const writeTree = persistence.writeTree.bind(persistence);
    let maximumEntries = 0;
    vi.spyOn(persistence, 'writeTree').mockImplementation(async (entries) => {
      maximumEntries = Math.max(maximumEntries, entries.length);
      return await writeTree(entries);
    });
    async function* members() {
      for (let index = 0; index < 25; index++) {
        yield [`member-${String(index).padStart(3, '0')}`, Buffer.from([index])];
      }
    }

    const staged = await bundles.putOrdered({ members: members() });

    expect(maximumEntries).toBeLessThanOrEqual(4);
    expect(staged.bundle).toMatchObject({ memberCount: 25, indexDepth: 3 });
    await expect(bundles.resolveRoot(staged.handle)).resolves.toMatchObject({
      memberCount: 25,
      indexDepth: 3,
    });
  });

  it('rejects out-of-order streams and impossible depth with staging evidence', async () => {
    const ordered = makeServices();
    await expect(
      ordered.bundles.putOrdered({
        members: [['z', Buffer.from('z')], ['a', Buffer.from('a')]],
      })
    ).rejects.toMatchObject({ code: 'BUNDLE_MEMBER_ORDER' });

    const shallow = makeServices({ limits: { maxFanoutEntries: 3, maxFanoutDepth: 1 } });
    await expect(
      shallow.bundles.put({
        members: { a: Buffer.from('a'), b: Buffer.from('b'), c: Buffer.from('c') },
      })
    ).rejects.toMatchObject({
      code: 'BUNDLE_FANOUT_LIMIT',
      meta: { staging: { objectCount: expect.any(Number) } },
    });
  });
});

describe('BundleService streaming bulk load', () => {
  it('flushes fanout nodes before a large ordered source is exhausted', async () => {
    const { bundles, pages, persistence } = makeServices({
      limits: { maxMembers: 5_000, maxFanoutEntries: 32, maxFanoutDepth: 4 },
    });
    const page = await pages.put({ source: Buffer.from('shared') });
    async function* members() {
      for (let index = 0; index < 5_000; index++) {
        if (index === 32) {
          expect(persistence.treeCount).toBeGreaterThan(0);
        }
        yield [`member-${String(index).padStart(4, '0')}`, page.handle];
      }
    }

    const staged = await bundles.putOrdered({ members: members() });

    expect(staged.bundle.memberCount).toBe(5_000);
    await expect(bundles.getMember({ handle: staged.handle, path: 'member-4999' }))
      .resolves.toMatchObject({ handle: page.handle });
  });
});

describe('BundleService targeted reads and corruption evidence', () => {
  it('opens only the selected member payload', async () => {
    const { bundles, pages, persistence } = makeServices({
      limits: { maxFanoutEntries: 4 },
    });
    const left = await pages.put({ source: Buffer.from('left') });
    const right = await pages.put({ source: Buffer.from('right') });
    const bundle = await bundles.put({ members: { left: left.handle, right: right.handle } });
    const readBlobStream = vi.spyOn(persistence, 'readBlobStream');
    const readTree = vi.spyOn(persistence, 'readTree');

    await expect(collect(bundles.openMember({ handle: bundle.handle, path: 'right' })))
      .resolves.toEqual(Buffer.from('right'));

    expect(readBlobStream).toHaveBeenCalledWith(right.handle.oid);
    expect(readBlobStream).not.toHaveBeenCalledWith(left.handle.oid);
    expect(readTree).not.toHaveBeenCalled();
  });

  it('attributes a missing selected target to its member path', async () => {
    const { bundles, pages, persistence } = makeServices();
    const page = await pages.put({ source: Buffer.from('temporary') });
    const bundle = await bundles.put({ members: { selected: page.handle } });
    persistence.deleteObject(page.handle.oid);

    await expect(bundles.getMember({ handle: bundle.handle, path: 'selected' }))
      .rejects.toMatchObject({
        code: 'HANDLE_TARGET_MISSING',
        meta: { memberPath: 'selected', bundleHandle: bundle.handle.toString() },
      });
    await expect(collect(bundles.openMember({ handle: bundle.handle, path: 'selected' })))
      .rejects.toMatchObject({
        code: 'HANDLE_TARGET_MISSING',
        meta: { memberPath: 'selected', bundleHandle: bundle.handle.toString() },
      });
  });

  it('reports a missing node descriptor as bundle corruption', async () => {
    const { bundles, persistence } = makeServices();
    const bundle = await bundles.put({ members: { selected: Buffer.from('value') } });
    const index = await persistence.readTreeEntry(bundle.handle.oid, 'index');
    const descriptor = await persistence.readTreeEntry(index.oid, 'node.json');
    persistence.deleteObject(descriptor.oid);

    await expect(bundles.getMember({ handle: bundle.handle, path: 'selected' }))
      .rejects.toMatchObject({ code: 'BUNDLE_CORRUPT', meta: { oid: descriptor.oid } });
  });
});

describe('BundleService imported admission bounds', () => {
  it('rejects a root whose member count exceeds its persisted policy', async () => {
    const { bundles, persistence } = makeServices();
    const staged = await bundles.put({ members: { selected: Buffer.from('value') } });
    const handle = await rewriteBundleRoot(persistence, staged.handle, (descriptor) => {
      descriptor.limits.maxMembers = 0;
    });

    await expect(bundles.resolveRoot(handle)).rejects.toMatchObject({
      code: 'BUNDLE_CORRUPT',
    });
  });

  it('rejects non-canonical persisted paths before traversal', async () => {
    const { bundles, persistence } = makeServices();
    const staged = await bundles.put({ members: { selected: Buffer.from('value') } });
    const handle = await rewriteBundleRoot(persistence, staged.handle, (descriptor) => {
      descriptor.index.firstPath = 'e\u0301';
      descriptor.index.lastPath = 'e\u0301';
    });

    const error = await bundles.resolveRoot(handle).then(
      () => null,
      (caught) => caught
    );

    expect(error).toMatchObject({
      code: 'BUNDLE_CORRUPT',
      meta: {
        path: 'e\u0301',
        originalError: { code: 'BUNDLE_PATH_INVALID' },
      },
    });
  });
});

describe('BundleService imported target validation', () => {
  it('caps the root descriptor read with the configured descriptor limit', async () => {
    const { bundles, persistence } = makeServices({
      limits: { maxDescriptorBytes: 1024 },
    });
    const staged = await bundles.put({ members: { selected: Buffer.from('value') } });
    const descriptor = await persistence.readTreeEntry(staged.handle.oid, 'bundle.json');
    const readBlob = vi.spyOn(persistence, 'readBlob');

    await bundles.resolveRoot(staged.handle);

    expect(readBlob).toHaveBeenCalledWith(descriptor.oid, 1024);
  });

  it('rejects member sizes that disagree with resolved targets', async () => {
    const { bundles, pages } = makeServices();
    const staged = await bundles.put({ members: { selected: Buffer.from('value') } });
    const resolveRoot = pages.resolveRoot.bind(pages);
    vi.spyOn(pages, 'resolveRoot').mockImplementation(async (handle) => {
      const target = await resolveRoot(handle);
      return { ...target, size: target.size + 1 };
    });

    await expect(bundles.resolveRoot(staged.handle)).rejects.toMatchObject({
      code: 'BUNDLE_CORRUPT',
      meta: { memberPath: 'selected', expectedSize: 5, actualSize: 6 },
    });
  });
});

describe('BundleService write preconditions', () => {
  it('rejects an invalid clock before writing any bundle objects', async () => {
    const { bundles, persistence } = makeServices({
      clock: { now: () => new Date('invalid') },
    });

    await expect(bundles.put({ members: { page: Buffer.from('not-written') } }))
      .rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    expect(persistence.blobCount).toBe(0);
    expect(persistence.treeCount).toBe(0);
  });
});
