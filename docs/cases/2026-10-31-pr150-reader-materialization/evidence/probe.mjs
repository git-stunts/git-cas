// Moriarty probes against /app (source at PR head 7a4a9e5).
import { materializeFile } from '/app/files.js';
import RuntimeJsonCodec from '/app/src/infrastructure/adapters/RuntimeJsonCodec.js';
import JsonCodec from '/app/src/infrastructure/codecs/JsonCodec.js';
import { mkdtemp, mkdir, writeFile, readFile, symlink, lstat, readdir, readlink, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const log = (...a) => console.log(...a);
async function* src(...chunks) { for (const c of chunks) { yield c; } }
async function attempt(label, fn) {
  try { log(label, 'OK', JSON.stringify(await fn())); }
  catch (e) { log(label, 'THREW', e?.constructor?.name, e?.code, String(e?.message).slice(0, 160)); }
}
const enc = (s) => new TextEncoder().encode(s);

log('runtime', process.version, 'bun?', (() => { try { return execSync('which bun deno').toString().trim(); } catch { return 'none'; } })());

// P1: leaf symlink inside base. Does "replace the destination" replace the link or write through it?
{
  const base = await mkdtemp(path.join(os.tmpdir(), 'm1-'));
  await mkdir(path.join(base, 'versions'));
  await writeFile(path.join(base, 'versions', 'v1.bin'), 'OLD-v1');
  await symlink('versions/v1.bin', path.join(base, 'current.bin'));
  await attempt('P1 leaf-symlink', () => materializeFile({ source: src(enc('NEW')), baseDirectory: base, outputPath: 'current.bin' }));
  const st = await lstat(path.join(base, 'current.bin'));
  log('P1 current.bin isSymlink=', st.isSymbolicLink(), 'link->', st.isSymbolicLink() ? await readlink(path.join(base, 'current.bin')) : '-');
  log('P1 versions/v1.bin now =', JSON.stringify(await readFile(path.join(base, 'versions', 'v1.bin'), 'utf8')));
}

// P2: hard-linked destination: old file shared with an outside path
{
  const base = await mkdtemp(path.join(os.tmpdir(), 'm2-'));
  await writeFile(path.join(base, 'a.bin'), 'OLD');
  await attempt('P2 trailing-slash outputPath', () => materializeFile({ source: src(enc('X')), baseDirectory: base, outputPath: 'dir-intended/' }));
  log('P2 entries', await readdir(base));
  await mkdir(path.join(base, 'existing-dir'));
  await attempt('P2 trailing-slash existing file', () => materializeFile({ source: src(enc('Y')), baseDirectory: base, outputPath: 'a.bin/' }));
  log('P2 a.bin =', await readFile(path.join(base, 'a.bin'), 'utf8'));
  await attempt('P2 destination is directory', () => materializeFile({ source: src(enc('Z')), baseDirectory: base, outputPath: 'existing-dir' }));
  await attempt('P2 NUL in outputPath', () => materializeFile({ source: src(enc('Z')), baseDirectory: base, outputPath: 'a\0b' }));
  await attempt('P2 missing base', () => materializeFile({ source: src(enc('Z')), baseDirectory: path.join(base, 'nope'), outputPath: 'x' }));
  log('P2 leftovers', (await readdir(base)).filter((n) => n.startsWith('.git-cas')));
}

// P3: after abort settles, the source keeps running (README closes the CAS session in finally).
{
  const base = await mkdtemp(path.join(os.tmpdir(), 'm3-'));
  const events = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const source = {
    async *[Symbol.asyncIterator]() {
      try {
        yield enc('a');
        events.push('source: blocked in pull');
        await gate; // e.g. waiting on git cat-file
        events.push('source: resumed and touches the (closed) session');
        yield enc('b');
      } finally { events.push('source: finally ran'); }
    },
  };
  const ac = new AbortController();
  const p = materializeFile({ source, baseDirectory: base, outputPath: 'x', signal: ac.signal });
  setTimeout(() => ac.abort(), 30);
  await attempt('P3 abort', () => p);
  events.push('caller: materializeFile settled -> README finally { cas.close() } runs now');
  release();
  await new Promise((r) => setTimeout(r, 30));
  log('P3 events', JSON.stringify(events, null, 1));
}

// P4: temp dir visible in application directory while streaming; no owner marker.
{
  const base = await mkdtemp(path.join(os.tmpdir(), 'm4-'));
  let seen;
  const source = { async *[Symbol.asyncIterator]() {
    yield enc('partial');
    await new Promise((r) => setTimeout(r, 20));
    const names = (await readdir(base));
    seen = await Promise.all(names.map(async (n) => ({ n, mode: ((await stat(path.join(base, n))).mode & 0o777).toString(8), inner: await readdir(path.join(base, n)).catch(() => null) })));
    yield enc('-rest');
  } };
  await attempt('P4', () => materializeFile({ source, baseDirectory: base, outputPath: 'asset.bin' }));
  log('P4 seen-by-concurrent-scan', JSON.stringify(seen));
}

// P5: JSON parity spot checks between RuntimeJsonCodec and JsonCodec
{
  const rt = new RuntimeJsonCodec(); const legacy = new JsonCodec();
  const cases = {
    bom: [0xef, 0xbb, 0xbf, 0x7b, 0x7d],
    loneSurrogateWTF8: [0x22, 0xed, 0xa0, 0x80, 0x22],
    nonchar: [0x22, 0xef, 0xbf, 0xbf, 0x22],
    escapedLone: [...enc('"\\ud800"')],
    overlongNul: [0x22, 0xc0, 0x80, 0x22],
  };
  for (const [k, bytes] of Object.entries(cases)) {
    const u = Uint8Array.from(bytes);
    const r = (() => { try { return JSON.stringify(rt.decode(u)); } catch (e) { return 'ERR ' + e.name; } })();
    const l = (() => { try { return JSON.stringify(legacy.decode(u)); } catch (e) { return 'ERR ' + e.name; } })();
    log('P5', k, r === l ? 'SAME' : 'DIFF', r, l);
  }
  // perf of fallback path: well-formed vs lone-surrogate payload
  const big = { path: 'x'.repeat(200), items: Array.from({ length: 2000 }, (_, i) => ({ i, name: 'file-' + i })) };
  const good = rt.encode(big);
  const bad = rt.encode({ ...big, path: '\ud800' + big.path });
  const time = (codec, b, n = 200) => { const t = process.hrtime.bigint(); for (let i = 0; i < n; i++) codec.decode(b); return Number(process.hrtime.bigint() - t) / 1e6 / n; };
  for (let w = 0; w < 2; w++) { time(rt, good, 20); time(legacy, good, 20); time(rt, bad, 20); time(legacy, bad, 20); }
  log('P5 ms/decode good: runtime', time(rt, good).toFixed(3), 'legacy', time(legacy, good).toFixed(3));
  log('P5 ms/decode lone-surrogate: runtime', time(rt, bad).toFixed(3), 'legacy', time(legacy, bad).toFixed(3));
}
