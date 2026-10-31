import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { materializeFile } from '@git-stunts/git-cas/files';

const writer = vi.hoisted(() => ({ fail: null }));
vi.mock('node:fs', async (original) => ({
  ...await original(),
  createWriteStream: () => new Writable({
    write(_chunk, _encoding, callback) { writer.fail = callback; },
  }),
}));

let base;
beforeEach(async () => { base = await mkdtemp(path.join(os.tmpdir(), 'cas-materialize-')); });
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

it('settles a write failure while the source is blocked', async () => {
  let entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  let unblock;
  const blocked = new Promise((resolve) => { unblock = resolve; });
  async function* stalled() {
    yield Uint8Array.of(65);
    entered();
    await blocked;
  }
  const failure = new Error('disk full');
  const pending = materializeFile({ source: stalled(), baseDirectory: base, outputPath: 'doc.md' });
  await ready;
  writer.fail(failure);
  await expect(pending).rejects.toBe(failure);
  unblock();
  expect(await readdir(base)).toEqual([]);
});
