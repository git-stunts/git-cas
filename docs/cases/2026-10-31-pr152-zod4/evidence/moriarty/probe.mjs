// Differential probe: base ManifestSchema.js on zod 3.25.76 vs head on zod 4.6.7.
import * as S3 from '/exp/schema-v3.mjs';
import * as S4 from '/exp/schema-v4.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/app/package.json');
const z4pkg = JSON.parse(fs.readFileSync('/app/node_modules/zod/package.json', 'utf8'));
const z3pkg = JSON.parse(fs.readFileSync('/app/node_modules/.pnpm/zod@3.25.76/node_modules/zod/package.json', 'utf8'));
console.log('zod head', z4pkg.version, 'zod base', z3pkg.version);

const b64 = (n, f) => Buffer.alloc(n, f).toString('base64');
const hex = (n, c = 'a') => c.repeat(n);
const chunk = (i) => ({ index: i, size: 1024, digest: hex(64), blob: hex(40, 'b') });

const seeds = {
  plain: { slug: 's', filename: 'f', size: 128, chunks: [chunk(0)] },
  whole: { version: 1, slug: 's', filename: 'f', size: 1, chunks: [chunk(0)],
    encryption: { scheme: 'whole', algorithm: 'aes-256-gcm', nonce: b64(12, 1), tag: b64(16, 2), encrypted: true,
      kdf: { algorithm: 'pbkdf2', salt: b64(16, 3), iterations: 100000 } } },
  framed: { version: 1, slug: 's', filename: 'f', size: 1, chunks: [chunk(0)],
    encryption: { scheme: 'framed', algorithm: 'aes-256-gcm', frameBytes: 65536, encrypted: true,
      recipients: [{ label: 'a', wrappedDek: b64(32, 4), nonce: b64(12, 5), tag: b64(16, 6), kekType: 'x', keyVersion: 0 }],
      keyVersion: 1 } },
  convergent: { version: 1, slug: 's', filename: 'f', size: 1, chunks: [chunk(0)],
    encryption: { scheme: 'convergent', algorithm: 'aes-256-gcm',
      kdf: { algorithm: 'scrypt', salt: b64(16, 3), cost: 16384, blockSize: 8, parallelization: 1, keyLength: 32 } } },
  legacyNoScheme: { slug: 's', filename: 'f', size: 1, chunks: [chunk(0)],
    encryption: { algorithm: 'aes-256-gcm', nonce: b64(12, 1), tag: b64(16, 2), encrypted: true } },
  v2: { version: 2, formatVersion: '1.2.3', manifestHash: hex(64), slug: 's', filename: 'f', size: 0, chunks: [],
    compression: { algorithm: 'gzip' }, chunking: { strategy: 'cdc', params: { target: 8, min: 4, max: 16, normalized: true } },
    subManifests: [{ oid: hex(64, 'c'), chunkCount: 3, startIndex: 0 }] },
  fixed: { slug: 's', filename: 'f', size: 0, chunks: [], chunking: { strategy: 'fixed', params: { chunkSize: 262144 } } },
};

// Canonical serializer: distinguishes missing vs undefined, -0, NaN, key order, prototypes.
function canon(v) {
  if (v === undefined) return 'U';
  if (typeof v === 'number') return Object.is(v, -0) ? 'N(-0)' : `N(${String(v)})`;
  if (typeof v === 'bigint') return `B(${v})`;
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${Array.from({ length: v.length }, (_, i) => (i in v ? canon(v[i]) : 'HOLE')).join(',')}]`;
  const proto = Object.getPrototypeOf(v);
  const p = proto === Object.prototype ? '' : proto === null ? 'nullproto' : `proto:${proto?.constructor?.name}`;
  return `${p}{${Reflect.ownKeys(v).map((k) => `${String(k)}:${canon(v[k])}`).join(',')}}`;
}

function run(S, schema, input) {
  const r = S[schema].safeParse(input);
  return r.success ? { ok: true, out: canon(r.data), sameRef: r.data === input }
    : { ok: false, msgs: r.error.issues.map((i) => i.message), paths: r.error.issues.map((i) => i.path.join('.')) };
}

const mutValues = [undefined, null, -0, 0, 1, -1, 1.5, NaN, Infinity, -Infinity, 2 ** 53, 2 ** 53 - 1, 2 ** 60, 1e21,
  '1', '', 'a', true, false, [], {}, [1], 10n, new Date(0), Object.create(null)];

function paths(obj, pre = []) {
  const out = [pre];
  if (obj && typeof obj === 'object') for (const k of Object.keys(obj)) out.push(...paths(obj[k], [...pre, k]));
  return out;
}
const clone = (o) => structuredClone(o);
function setAt(o, p, v, del) {
  if (p.length === 0) return v;
  let cur = o; for (const k of p.slice(0, -1)) cur = cur[k];
  if (del) delete cur[p.at(-1)]; else cur[p.at(-1)] = v;
  return o;
}

const diffs = []; let total = 0; let msgDiffs = [];
function compare(label, schema, input) {
  total++;
  let a, b;
  try { a = run(S3, schema, input); } catch (e) { a = { threw: String(e) }; }
  try { b = run(S4, schema, input); } catch (e) { b = { threw: String(e) }; }
  if (a.ok !== b.ok || (a.ok && a.out !== b.out) || a.threw !== b.threw) diffs.push({ label, a, b });
  else if (!a.ok && JSON.stringify(a.msgs) !== JSON.stringify(b.msgs)) msgDiffs.push({ label, z3: a.msgs, z4: b.msgs });
}

for (const [name, seed] of Object.entries(seeds)) {
  compare(`${name}:seed`, 'ManifestSchema', clone(seed));
  for (const p of paths(seed)) {
    if (p.length === 0) continue;
    compare(`${name}:delete ${p.join('.')}`, 'ManifestSchema', setAt(clone(seed), p, undefined, true));
    for (const v of mutValues) {
      let vv = v; try { vv = structuredClone(v); } catch {}
      compare(`${name}:set ${p.join('.')}=${canon(v)}`, 'ManifestSchema', setAt(clone(seed), p, vv, false));
    }
    // unknown sibling key / __proto__ own key
    const parent = p.slice(0, -1);
    const base = clone(seed); let tgt = base; for (const k of parent) tgt = tgt[k];
    if (tgt && typeof tgt === 'object' && !Array.isArray(tgt)) {
      const c1 = clone(seed); let t1 = c1; for (const k of parent) t1 = t1[k];
      t1.unknownKey = 1; compare(`${name}:unknown under ${parent.join('.')}`, 'ManifestSchema', c1);
      const c2 = clone(seed); let t2 = c2; for (const k of parent) t2 = t2[k];
      Object.defineProperty(t2, '__proto__', { value: { polluted: 1 }, enumerable: true, configurable: true, writable: true });
      compare(`${name}:own __proto__ under ${parent.join('.')}`, 'ManifestSchema', c2);
    }
  }
  // JSON round trip of __proto__
  compare(`${name}:JSON __proto__`, 'ManifestSchema', JSON.parse(JSON.stringify(seed).replace(/^\{/, '{"__proto__":{"slug":"x"},')));
  // null-prototype, frozen, class instance, getters, sparse arrays
  const np = Object.assign(Object.create(null), clone(seed)); compare(`${name}:nullproto`, 'ManifestSchema', np);
  const fr = clone(seed); Object.freeze(fr); compare(`${name}:frozen`, 'ManifestSchema', fr);
  class K { constructor(o) { Object.assign(this, o); } }
  compare(`${name}:class`, 'ManifestSchema', new K(clone(seed)));
  const inh = Object.create(clone(seed)); compare(`${name}:inherited-props`, 'ManifestSchema', inh);
  let n = 0; const g = clone(seed); Object.defineProperty(g, 'size', { get() { n++; return n === 1 ? 1 : -5; }, enumerable: true });
  compare(`${name}:stateful getter`, 'ManifestSchema', g);
  const sp = clone(seed); sp.chunks = [chunk(0), , chunk(2)]; compare(`${name}:sparse`, 'ManifestSchema', sp);
  const sp2 = clone(seed); sp2.chunks = new Array(2); compare(`${name}:all-holes`, 'ManifestSchema', sp2);
  const ex = clone(seed); for (const k of ['formatVersion', 'manifestHash', 'encryption', 'compression', 'chunking', 'subManifests']) if (!(k in ex)) ex[k] = undefined;
  compare(`${name}:explicit undefined optionals`, 'ManifestSchema', ex);
  if (seed.encryption) {
    const e = clone(seed); e.encryption.kdf = undefined; e.encryption.nonce ??= undefined; e.encryption.tag ??= undefined; e.encryption.frameBytes ??= undefined;
    compare(`${name}:explicit undefined enc`, 'ManifestSchema', e);
  }
}

// direct schemas
for (const v of [{ index: 0, size: 1, digest: hex(64), blob: hex(40) }, { index: -0, size: 1, digest: hex(64), blob: hex(64) }])
  compare('chunk', 'ChunkSchema', v);
compare('kdf no keyLength', 'KdfSchema', { algorithm: 'pbkdf2', salt: b64(8, 1) });
compare('kdf keyLength undefined', 'KdfSchema', { algorithm: 'pbkdf2', salt: b64(8, 1), keyLength: undefined });

console.log('total cases', total, 'divergent accept/output', diffs.length, 'message-only diffs', msgDiffs.length);
fs.writeFileSync('/exp/out-diffs.json', JSON.stringify({ diffs, msgDiffs }, null, 1));
for (const d of diffs.slice(0, 60)) console.log('DIFF', JSON.stringify(d));
