import { describe, expect, it } from 'vitest';
import PageService from '../../../../src/domain/services/PageService.js';
import PageHandle from '../../../../src/domain/value-objects/PageHandle.js';
import StagedPage from '../../../../src/domain/value-objects/StagedPage.js';
import MemoryPersistenceAdapter from '../../../helpers/MemoryPersistenceAdapter.js';

const OBSERVED_AT = '2026-07-13T11:00:00.000Z';

function makePages(maxPageSize = 1024) {
  const persistence = new MemoryPersistenceAdapter();
  const pages = new PageService({
    persistence,
    maxPageSize,
    clock: { now: () => new Date(OBSERVED_AT) },
  });
  return { pages, persistence };
}

async function collect(source) {
  const chunks = [];
  for await (const chunk of source) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe('PageService defaults', () => {
  it('honors the documented 16 MiB default rather than the chunk-size default', async () => {
    const persistence = new MemoryPersistenceAdapter();
    const pages = new PageService({ persistence });
    const bytes = new Uint8Array((1024 * 1024) + 1);

    const staged = await pages.put({ source: bytes });

    expect(staged.page.size).toBe(bytes.length);
  });
});

describe('PageService', () => {
  it('deduplicates identical page bytes and streams them back', async () => {
    const { pages, persistence } = makePages();
    const bytes = Buffer.from('same immutable page');

    const first = await pages.put({ source: bytes });
    const second = await pages.put({ source: (async function* source() { yield bytes; })() });

    expect(first).toBeInstanceOf(StagedPage);
    expect(first.handle).toBeInstanceOf(PageHandle);
    expect(second.handle.toString()).toBe(first.handle.toString());
    expect(persistence.blobCount).toBe(1);
    expect(first.page.size).toBe(bytes.length);
    expect(first.retention.protection).toBe('not-established');
    await expect(collect(pages.open({ handle: first.handle }))).resolves.toEqual(bytes);
    await expect(pages.get({ handle: first.handle })).resolves.toEqual(new Uint8Array(bytes));
  });

  it('enforces configured and operation page limits while consuming', async () => {
    const { pages } = makePages(4);
    const source = (async function* chunks() {
      yield Buffer.from('abc');
      yield Buffer.from('de');
    })();

    await expect(pages.put({ source })).rejects.toMatchObject({
      code: 'PAGE_TOO_LARGE',
      meta: { observedBytes: 5, maxBytes: 4 },
    });
    await expect(pages.put({ source: Buffer.from('x'), maxBytes: 5 })).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
  });

  it('reports missing and wrong-kind targets through handle evidence', async () => {
    const { pages, persistence } = makePages();
    const missing = new PageHandle({ oid: 'f'.repeat(40) });
    const treeOid = await persistence.writeTree([]);
    const tree = new PageHandle({ oid: treeOid });

    await expect(pages.resolveRoot(missing)).rejects.toMatchObject({
      code: 'HANDLE_TARGET_MISSING',
      meta: { handle: missing.toString() },
    });
    await expect(pages.resolveRoot(tree)).rejects.toMatchObject({
      code: 'HANDLE_TARGET_TYPE_MISMATCH',
      meta: { actualType: 'tree', expectedType: 'blob' },
    });
  });
});

describe('PageService imported handles', () => {
  it('rejects an existing blob that exceeds the configured page limit', async () => {
    const { pages, persistence } = makePages(4);
    const oid = await persistence.writeBlob(Buffer.from('oversized'));
    const handle = new PageHandle({ oid });

    await expect(pages.resolveRoot(handle)).rejects.toMatchObject({
      code: 'PAGE_TOO_LARGE',
      meta: { observedBytes: 9, maxBytes: 4 },
    });
  });

  it('rejects an invalid clock before writing a page blob', async () => {
    const persistence = new MemoryPersistenceAdapter();
    const pages = new PageService({
      persistence,
      clock: { now: () => new Date('invalid') },
    });

    await expect(pages.put({ source: Buffer.from('not-written') })).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
    expect(persistence.blobCount).toBe(0);
  });
});
