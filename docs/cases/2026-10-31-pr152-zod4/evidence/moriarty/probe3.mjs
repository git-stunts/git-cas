// Global-config leakage: a host application's own zod 4 config changes git-cas's
// Manifest error contract and (via customError) its messages. Uses the head source in /app.
import { readFileSync } from 'node:fs';
const Manifest = (await import('/app/src/domain/value-objects/Manifest.js')).default;
const bad = { slug: 's', filename: 'f', size: 'x', chunks: [] };
const msg = () => { try { new Manifest(bad); return 'accepted'; } catch (e) { return e.message; } };
console.log('baseline           :', msg());
// Simulate a host app that configures ITS OWN zod 4 copy. To prove the channel is
// globalThis (not module identity), import the config through a *different* module URL.
const hostZ = await import('/app/node_modules/zod/v4/index.js?host-copy');
console.log('distinct module    :', hostZ.z !== (await import('/app/node_modules/zod/index.js')).z);
hostZ.z.config(hostZ.z.locales.de());
console.log('after host de()    :', msg());
hostZ.z.config({ customError: () => 'HOST-SAYS-NO' });
console.log('after customError  :', msg());
// Custom (schema-level) messages still win?
const badDigest = { slug: 's', filename: 'f', size: 1, chunks: [{ index: 0, size: 1, digest: 'zz', blob: 'b'.repeat(40) }] };
try { new Manifest(badDigest); } catch (e) { console.log('custom msg w/ host :', e.message); }
console.log('__zod_globalConfig :', Object.keys(globalThis.__zod_globalConfig));
const core = readFileSync('/app/node_modules/zod/v4/core/core.js', 'utf8').split('\n');
console.log('core.js 100-110:\n' + core.slice(99, 110).map((l, i) => `${100 + i}: ${l}`).join('\n'));
const checks = readFileSync('/app/node_modules/zod/v4/core/checks.js', 'utf8').split('\n');
console.log('checks.js 115-135:\n' + checks.slice(114, 135).map((l, i) => `${115 + i}: ${l}`).join('\n'));
const S3 = await import('/exp/schema-v3.mjs');
const r3 = S3.ManifestSchema.safeParse(bad);
console.log('base (zod3) w/ host config:', r3.error.issues.map((i) => i.message).join(', '));
