import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import ContentAddressableStore from '../../index.js';
import { materializeFile } from '@git-stunts/git-cas/files';

let directory;
let cas;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'cas-file-api-'));
  execFileSync('git', ['init', '--bare', path.join(directory, 'repo')], { stdio: 'ignore' });
  cas = await ContentAddressableStore.open({ cwd: path.join(directory, 'repo'), chunkSize: 1024 });
});
afterEach(async () => {
  await cas?.close();
  await rm(directory, { recursive: true, force: true });
});

async function* bytes(value) { yield value; }
async function collect(source) {
  const chunks = [];
  for await (const chunk of source) { chunks.push(chunk); }
  return Buffer.concat(chunks);
}

describe('optional file helper with real Git and unchanged byte APIs', () => {
  it.each([null, 'whole', 'framed', 'convergent'])('materializes %s and retains streaming access', async (scheme) => {
    const payload = Buffer.from('日本語 and metadata\n'.repeat(300));
    const key = new Uint8Array(32).fill(7);
    const encryption = scheme ? { encryptionKey: key, encryption: { scheme } } : {};
    const staged = await cas.assets.put({ source: bytes(payload), slug: 'test/file', ...encryption });
    const open = () => cas.assets.open({ handle: staged.handle, ...(scheme ? { encryptionKey: key } : {}) });
    const expectedSha256 = createHash('sha256').update(payload).digest('hex');
    expect(await collect(open())).toEqual(payload);
    await expect(materializeFile({
      source: open(), baseDirectory: directory, outputPath: 'doc.md', expectedSha256,
    })).resolves.toEqual({ bytesWritten: payload.length });
    expect(await readFile(path.join(directory, 'doc.md'))).toEqual(payload);
    expect(await collect(open())).toEqual(payload);
    expect((await readdir(directory)).sort()).toEqual(['doc.md', 'repo']);
  });

  it.each(['whole', 'framed', 'convergent'])('preserves existing output on %s auth failure', async (scheme) => {
    const key = new Uint8Array(32).fill(7);
    const staged = await cas.assets.put({
      source: bytes(Buffer.from('secret'.repeat(400))), slug: 'test/secret',
      encryptionKey: key, encryption: { scheme },
    });
    await writeFile(path.join(directory, 'doc.md'), 'original');
    const source = cas.assets.open({ handle: staged.handle, encryptionKey: new Uint8Array(32).fill(8) });
    await expect(materializeFile({ source, baseDirectory: directory, outputPath: 'doc.md' }))
      .rejects.toMatchObject({ code: 'INTEGRITY_ERROR' });
    expect(await readFile(path.join(directory, 'doc.md'), 'utf8')).toBe('original');
    expect((await readdir(directory)).sort()).toEqual(['doc.md', 'repo']);
  });

  it('keeps manifest buffer and byte-stream restore APIs usable without file publication', async () => {
    const payload = Buffer.from('raw buffer and stream');
    const manifest = await cas.store({ source: bytes(payload), slug: 'raw', filename: 'raw.txt' });
    expect(Buffer.from((await cas.restore({ manifest })).buffer)).toEqual(payload);
    expect(await collect(cas.restoreStream({ manifest }))).toEqual(payload);
    expect(await readdir(directory)).toEqual(['repo']);
  });
});
