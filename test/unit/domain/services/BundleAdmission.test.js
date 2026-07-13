import { describe, expect, it } from 'vitest';
import BundleService from '../../../../src/domain/services/BundleService.js';
import PageService from '../../../../src/domain/services/PageService.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import MemoryPersistenceAdapter from '../../../helpers/MemoryPersistenceAdapter.js';

function makeBundle(limits) {
  const persistence = new MemoryPersistenceAdapter();
  const pages = new PageService({ persistence });
  return new BundleService({
    persistence,
    codec: new JsonCodec(),
    pages,
    limits,
    resolveHandle: (handle) => pages.resolveRoot(handle),
    openHandle: (handle) => pages.open({ handle }),
  });
}

describe('BundleService admission limits', () => {
  it.each([
    [{ '/root': Buffer.from('x') }, 'BUNDLE_PATH_INVALID'],
    [{ '../root': Buffer.from('x') }, 'BUNDLE_PATH_INVALID'],
    [{ 'e\u0301': Buffer.from('x') }, 'BUNDLE_PATH_INVALID'],
    [{ 'control\u0085path': Buffer.from('x') }, 'BUNDLE_PATH_INVALID'],
    [{ 'surrogate\ud800path': Buffer.from('x') }, 'BUNDLE_PATH_INVALID'],
  ])('rejects unsafe path corpus %#', async (members, code) => {
    await expect(makeBundle().put({ members })).rejects.toMatchObject({ code });
  });

  it('enforces member, UTF-8 path, and descriptor byte limits', async () => {
    await expect(
      makeBundle({ maxMembers: 1 }).put({ members: { a: Buffer.from('a'), b: Buffer.from('b') } })
    ).rejects.toMatchObject({ code: 'BUNDLE_MEMBER_LIMIT' });

    await expect(
      makeBundle({ maxMemberPathBytes: 3 }).put({ members: { 'éé': Buffer.from('x') } })
    ).rejects.toMatchObject({ code: 'BUNDLE_PATH_LIMIT', meta: { pathBytes: 4 } });

    await expect(
      makeBundle({ maxDescriptorBytes: 64 }).put({ members: { member: Buffer.from('x') } })
    ).rejects.toMatchObject({
      code: 'BUNDLE_DESCRIPTOR_LIMIT',
      meta: { staging: { objectCount: expect.any(Number) } },
    });
  });

  it('rejects duplicate paths in ordered input', async () => {
    await expect(
      makeBundle().putOrdered({
        members: [['same', Buffer.from('a')], ['same', Buffer.from('b')]],
      })
    ).rejects.toMatchObject({ code: 'BUNDLE_DUPLICATE_PATH' });
  });
});
