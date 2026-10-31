import fs from 'node:fs';
const Z3 = '/app/node_modules/.pnpm/zod@3.25.76/node_modules/zod/index.js';
const src = fs.readFileSync('/app/src/domain/schemas/ManifestSchema.js', 'utf8');
fs.mkdirSync('/tmp/s', { recursive: true });
const fix = (s, zp) => s.replace("from 'zod'", `from '${zp}'`)
  .replace("'../../helpers/canonicalBase64.js'", "'/app/src/helpers/canonicalBase64.js'")
  .replace("'../encoding/base64.js'", "'/app/src/domain/encoding/base64.js'");
fs.writeFileSync('/tmp/s/s3.mjs', fix(src, Z3));
const S3 = await import('/tmp/s/s3.mjs');
const S4 = await import('/app/src/domain/schemas/ManifestSchema.js');
const { default: Manifest } = await import('/app/src/domain/value-objects/Manifest.js');
const { default: Chunk } = await import('/app/src/domain/value-objects/Chunk.js');
const z4 = (await import('/app/node_modules/zod/index.js')).default;
console.log('zod4 default export has object():', typeof z4.object, 'version', z4.core?.version ?? '?');

const b64 = (n) => Buffer.alloc(n, 7).toString('base64');
const hex = (n) => 'a'.repeat(n);
const chunk = (i) => ({ index: i, size: 10, digest: hex(64), blob: hex(40) });
const base = () => ({ slug: 's', filename: 'f', size: 10, chunks: [chunk(0)] });
const whole = () => ({ scheme: 'whole', algorithm: 'aes-256-gcm', nonce: b64(12), tag: b64(16) });
const kdf = { algorithm: 'pbkdf2', salt: b64(16), iterations: 1000 };
const cases = {
  valid_min: base(),
  valid_whole_kdf: { ...base(), encryption: { ...whole(), kdf } },
  valid_framed: { ...base(), encryption: { scheme: 'framed', algorithm: 'aes-256-gcm', frameBytes: 65536 } },
  framed_explicit_undefined_nonce: { ...base(), encryption: { scheme: 'framed', algorithm: 'aes-256-gcm', frameBytes: 65536, nonce: undefined } },
  whole_explicit_undefined_frameBytes: { ...base(), encryption: { ...whole(), frameBytes: undefined } },
  unknown_keys: { ...base(), extra: 1, encryption: { ...whole(), extra: 2 } },
  size_string: { ...base(), size: '10' },
  size_2p60: { ...base(), size: 2 ** 60 },
  size_max_safe: { ...base(), size: Number.MAX_SAFE_INTEGER },
  size_float: { ...base(), size: 1.5 },
  size_infinity: { ...base(), size: Infinity },
  size_NaN: { ...base(), size: NaN },
  version_3: { ...base(), version: 3 },
  version_undefined_explicit: { ...base(), version: undefined },
  enc_no_scheme: { ...base(), encryption: { algorithm: 'aes-256-gcm', nonce: b64(12), tag: b64(16) } },
  enc_bad_scheme: { ...base(), encryption: { ...whole(), scheme: 'nope' } },
  enc_whole_missing_nonce: { ...base(), encryption: { scheme: 'whole', algorithm: 'aes-256-gcm', tag: b64(16) } },
  enc_whole_noncanonical_nonce: { ...base(), encryption: { ...whole(), nonce: 'AAAA' } },
  enc_whole_float_keyVersion: { ...base(), encryption: { ...whole(), keyVersion: 1.5 } },
  enc_framed_with_nonce: { ...base(), encryption: { scheme: 'framed', algorithm: 'aes-256-gcm', frameBytes: 1, nonce: b64(12) } },
  enc_framed_float_frameBytes: { ...base(), encryption: { scheme: 'framed', algorithm: 'aes-256-gcm', frameBytes: 1.5 } },
  enc_encrypted_false: { ...base(), encryption: { ...whole(), encrypted: false } },
  enc_recipients_empty: { ...base(), encryption: { ...whole(), recipients: [] } },
  enc_kdf_bad_alg: { ...base(), encryption: { ...whole(), kdf: { ...kdf, algorithm: 'argon2' } } },
  chunking_missing_strategy: { ...base(), chunking: { params: { chunkSize: 1 } } },
  chunking_bad_strategy: { ...base(), chunking: { strategy: 'x', params: { chunkSize: 1 } } },
  chunking_fixed_bad_param: { ...base(), chunking: { strategy: 'fixed', params: { chunkSize: -1 } } },
  compression_bad: { ...base(), compression: { algorithm: 'zstd' } },
  digest_bad: { ...base(), chunks: [{ ...chunk(0), digest: 'zz' }] },
  slug_missing: { filename: 'f', size: 1, chunks: [] },
  formatVersion_bad: { ...base(), formatVersion: 'x' },
  null_input: null,
};
const run = (S, v) => { const r = S.ManifestSchema.safeParse(v); return r.success ? { ok: true, out: r.data, keys: r.data.encryption ? Object.keys(r.data.encryption) : undefined } : { ok: false, msgs: r.error.issues.map((i) => i.message), codes: r.error.issues.map((i) => i.code + '@' + i.path.join('.')) }; };
const mm = (v) => { try { new Manifest(v); return 'OK'; } catch (e) { return `${e.constructor.name}: ${e.message}`; } };
for (const [k, v] of Object.entries(cases)) {
  const a = run(S3, v), b = run(S4, v);
  const same = JSON.stringify(a) === JSON.stringify(b);
  console.log(`\n### ${k} ${same ? 'SAME' : 'DIFF'}`);
  console.log(' z3:', JSON.stringify(a));
  if (!same) console.log(' z4:', JSON.stringify(b));
  console.log(' Manifest(z4):', mm(v));
}
// Chunk value object and ManifestRepository-style raw ZodError message
try { new Chunk({ index: 0, size: 'x', digest: 'zz', blob: 'q' }); } catch (e) { console.log('\nChunk(z4):', e.message); }
for (const [n, S] of [['z3', S3], ['z4', S4]]) { try { S.ChunkSchema.parse({ index: 0, size: 0, digest: hex(64), blob: hex(40) }); } catch (e) { console.log(`raw ZodError.message ${n}:`, JSON.stringify(e.message)); } }
// Composability: zod3 object containing zod4 schema, and vice versa
const z3 = (await import(Z3)).default;
for (const [n, f] of [['z3.object({x: S4.ChunkSchema})', () => z3.object({ x: S4.ChunkSchema }).parse({ x: chunk(0) })], ['z4.object({x: S4.ChunkSchema})', () => z4.object({ x: S4.ChunkSchema }).parse({ x: chunk(0) })], ['S4.ChunkSchema.extend', () => S4.ChunkSchema.extend({ y: z4.string() }).parse({ ...chunk(0), y: 'q' })]]) {
  try { console.log(n, '->', JSON.stringify(f())); } catch (e) { console.log(n, 'THROWS', e.constructor.name, String(e.message).slice(0, 160)); }
}
// default inside optional kdf: keyLength
console.log('\nkdf keyLength z3', run(S3, cases.valid_whole_kdf).out.encryption.kdf.keyLength, 'z4', run(S4, cases.valid_whole_kdf).out.encryption.kdf.keyLength);
