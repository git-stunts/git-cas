# Upgrading git-cas

v6.0.0 is a major release that simplifies the encryption model, hardens security defaults, and cleans up the architecture. This guide covers every breaking change and what you need to do.

## v6.5.3 To v6.5.4

v6.5.4 adds `workspace.pages.putBatch()` and requires no stored-data migration.
Callers that stage many bounded pages can opt into one count-and-byte-bounded
page write plus one workspace-generation installation:

```js
const staged = await workspace.pages.putBatch({
  pages: sources.map((source) => ({ source })),
  maxBatchPages: 256,
});
```

Results preserve input order, including repeated content, and every result has
an exact retained witness for the same workspace generation. Existing
`workspace.pages.put()` behavior is unchanged. Applications do not need to
adopt the batch API unless they need to remove per-page root-set rewrites.

See [v6.5.4 Release Notes](./docs/releases/v6.5.4.md) for the measured
8,188-page migration workload and compatibility details.

## v6.5.2 To v6.5.3

v6.5.3 changes no public API and requires no stored-data migration. Long-lived
stores automatically preserve their typed `cat-file` session across successful
immutable writes. They also preserve typed `mktree` across loose blob and tree
writes, while bounded bulk writes still retire `mktree` because `fast-import`
may create a pack that an already prepared process cannot discover.

No application code changes are required. Continue to call `await cas.close()`
when the store is no longer needed; explicit closure remains the deterministic
boundary for local Git children and bounded in-memory residency.

See [v6.5.3 Release Notes](./docs/releases/v6.5.3.md) for the audited coherence
matrix and measured process-count reduction.

## v6.5.1 To v6.5.2

v6.5.2 is API-additive and does not require stored-data migration. Immutable
metadata and tree reads automatically reuse bounded typed Git sessions when the
injected plumbing supports them. Existing structural adapters remain compatible
and continue through the command-per-operation fallback.

Use `pages.putBatch()` when an application already has an explicit bounded page
group. The default envelope accepts at most 256 pages and 32 MiB, supports a
lower `maxBytes` on each page, preserves input order, and performs no writes
until the complete bounded batch is valid. Individual `pages.put()` calls remain
one-shot so an externally pruned unreachable blob can be recreated correctly.

Call `await cas.close()` when the store is no longer needed, especially when an
operation may still be active or a stream may remain unconsumed. Closing drains
or terminates local Git processes and releases bounded cache residency only; it
does not delete stored objects, move refs, or change retention or publication
state.

See [v6.5.2 Release Notes](./docs/releases/v6.5.2.md) and
[Application Storage](./docs/API.md#application-storage) for the complete batch,
streaming, and lifecycle contracts.

## v6.5.0 To v6.5.1

v6.5.1 is API-additive and does not require stored-data migration. Repeated
`pages.get()` calls now reuse immutable payload bytes through a process-local
LRU bounded by entry count and aggregate bytes. Applications may tune the
defaults with `pageCacheEntries` and `pageCacheBytes` when constructing the
store.

Every caller still receives an independent `Uint8Array`, and each call's
`maxBytes` limit remains authoritative on cold, resident, and shared in-flight
reads. Rejected work remains retryable, and an individually oversized payload
does not displace unrelated residents.

`pages.open()` remains the streaming API and never enters the payload cache.
Cache residence is an optimization, not retention evidence; keep each handle
reachable through a workspace, RootSet, cache acquisition, publication, or
other documented lifetime while consuming it.

See [v6.5.1 Release Notes](./docs/releases/v6.5.1.md) and
[Application Storage](./docs/API.md#application-storage) for the complete
residency and lifetime contract.

## v6.4.0 To v6.5.0

v6.5.0 is API-additive and does not require stored-data migration. It adds
bounded reference reads for callers that need a member handle without
recursively resolving that member's complete support graph.

Use `getMemberReference()` for one exact path:

```javascript
const reference = await cas.bundles.getMemberReference({
  handle: materializationBundle,
  path: 'nodes/user-alice.cbor',
});

if (reference) {
  await consumeRetainedHandle(reference.handle);
}
```

Use `iterateMemberReferences()` for a streaming structural scan:

```javascript
for await (const reference of cas.bundles.iterateMemberReferences({
  handle: materializationBundle,
})) {
  await indexReference(reference);
}
```

These APIs validate the bundle root, every traversed descriptor summary, the
selected or enumerated Git tree edges, and each direct target object type. They
do not recursively validate nested page, asset, or bundle support graphs. Keep
using `getMember()` or `iterateMembers()` when the operation requires complete
recursive validation and computed `logicalBytes`.

Reference results are observations, not retention claims. Keep the containing
bundle reachable through a workspace, cache acquisition, RootSet, or other
documented lifetime while consuming them. The immutable metadata and
descriptor caches introduced in v6.5.0 are bounded internal implementation
details; callers do not manage or invalidate them.

See [v6.5.0 Release Notes](./docs/releases/v6.5.0.md) and
[Application Storage](./docs/API.md#application-storage) for the
complete integrity and lifetime contract.

## v6.3.0 To v6.4.0

v6.4.0 is API-additive and does not require stored-data migration. It adds
scoped staging workspaces for applications that construct one durable result
from many intermediate assets, pages, or bundles.

Do not use a CacheSet as temporary construction storage. Open one workspace,
stage the intermediate values through it, compact the retained roots after an
aggregate becomes transitively complete, and promote only the terminal handle:

```javascript
const workspace = await cas.workspaces.open({
  namespace: 'my-application/materializations',
  ttlMs: 2 * 60 * 60 * 1000,
});

try {
  const page = await workspace.pages.put({ source: encodedPage });
  const bundle = await workspace.bundles.putOrdered({
    members: [['pages/result.cbor', page.handle]],
  });
  await workspace.checkpoint({ handles: [bundle.handle] });
  await workspace.promoteToCache({ cache, key, handle: bundle.handle });
} finally {
  await workspace.release();
}
```

Every returned staged value is anchored by an exact workspace generation.
Promotion requires matching destination retention evidence before source
release. Expiry is diagnostic posture, not automatic deletion; abandoned
workspaces remain reachable until a caller traverses bounded `inspect()` or
`sweep()` pages using `nextCursor`.

The interval between writing an object and publishing the workspace ref still
depends on Git's ordinary unreachable-object grace period. Concurrent
immediate-expiry pruning inside that interval is unsupported.

See [v6.4.0 Release Notes](./docs/releases/v6.4.0.md) and
[Scoped Staging Workspaces](./docs/API.md#scoped-staging-workspaces) for the
complete retention, promotion, and recovery contract.

## v6.2.0 To v6.3.0

v6.3.0 is API-additive and does not require stored-data migration. It adds
scoped cache acquisitions for consumers that must keep a cache hit reachable
between lookup and use.

`CacheSet.get()` retains its existing complete-validation semantics, but a
returned hit is only an observation. Use `acquire()` when consumption may
overlap replacement, expiry, eviction, removal, or destructive Git cleanup:

```javascript
const acquisition = await cache.acquire(materializationKey);
if (acquisition) {
  try {
    await consume(acquisition.hit.handle);
  } finally {
    await acquisition.release();
  }
}
```

An acquisition anchors the exact observed cache generation until explicit,
idempotent release. It intentionally has no automatic TTL: age is diagnostic
evidence, not proof that a consumer is dead. Recovery tooling can use
`cache.inspectAcquisitions({ limit })` and generation-checked
`cache.releaseAcquisition(...)`; `cas.diagnostics.doctor()` reports bounded
count, age, truncation, malformed-ref, and clock-skew evidence.

See [v6.3.0 Release Notes](./docs/releases/v6.3.0.md) and
[Acquire And Release](./docs/API.md#acquire-and-release) for the complete
lifetime and recovery contract.

## v6.1.0 To v6.2.0

v6.2.0 is API-additive and does not require stored-data migration. It adds
high-level application storage, managed cache and replay lifecycles, immutable
retention evidence, and repository-wide diagnostics.

Applications should stop treating a naked Git object ID stored in JSON as a
durability guarantee. Stage content through `assets`, `pages`, or `bundles`,
then retain or publish the returned opaque handle through the policy surface
that matches its lifecycle:

```javascript
const staged = await cas.assets.put({
  source,
  slug: 'warp/materialization',
  filename: 'materialization.bin',
});

const cache = await cas.caches.open({
  namespace: 'git-warp/materializations',
  policy: { maxEntries: 10_000, maxBytes: 2 * 1024 * 1024 * 1024 },
});
const stored = await cache.put(cacheKey, staged.handle, {
  retention: 'evictable',
  expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
});
```

Existing root sets and vault entries remain valid. Before running destructive
Git cleanup, applications migrating an existing object-ID index must first
enumerate every still-live object, validate that it still exists, and adopt it
into a RootSet or rebuild it through the appropriate high-level API. Neither
repair nor diagnostics can recover an object that Git already pruned.

Use `cas.diagnostics.doctor()` before and after migration to inspect anchored,
orphaned, and grace-expired object counts plus managed CacheSet, RootSet,
ExpiringSet, and Vault usage. The doctor is read-only; it never runs Git GC or
prune. Repository diagnostics require `@git-stunts/plumbing` 3.1.0 or newer.

See [v6.2.0 Release Notes](./docs/releases/v6.2.0.md) and
[Application Storage](./docs/API.md#application-storage) for the complete
capability and policy map.

## v6.0.1 To v6.1.0

v6.1.0 is API-additive and does not require stored-data migration. It adds root
sets for mutable, GC-safe retention of cache and derived-state objects.

Applications that persisted tree OIDs only inside JSON should adopt every
still-live OID before running destructive Git cleanup:

```javascript
const rootSet = await cas.rootSets.open({
  ref: 'refs/cas/rootsets/my-application/cache',
});

await rootSet.repair({
  entries: liveRecords.map((record) => ({
    name: record.id,
    oid: record.treeOid,
    type: 'tree',
    retention: 'evictable',
  })),
});
```

Repair cannot recover objects that Git already pruned. Verify
`(await rootSet.doctor()).healthy` before garbage collection. Existing vault
entries and ordinary branch/tag references need no change.

## Quick Start

If you have an existing vault with encrypted assets:

```bash
# See what needs migration (safe — no changes made)
npm run upgrade

# Apply the migration using stdin for the content passphrase
printf '%s\n' '<your-content-passphrase>' | npm run upgrade -- --execute --passphrase-file -
```

If you only use the library API (no vault), skip to [API Changes](#api-changes).

---

## Critical Breaking Changes

### `restoreFile()` Requires `baseDirectory`

`restoreFile()` now requires an explicit directory boundary. This prevents a
repository-controlled output path from writing outside the directory your
application intended to restore into.

v5 accepted an output path by itself:

```javascript
await cas.restoreFile({ manifest, outputPath: './restored.bin' });
```

v6 requires the restore boundary:

```javascript
await cas.restoreFile({
  manifest,
  outputPath: './restored.bin',
  baseDirectory: process.cwd(),
});
```

Use `process.cwd()` only when the caller is a trusted local CLI or script. Server
and automation contexts should pass an application-controlled restore directory,
for example a job workspace or tenant-scoped artifact directory.

---

## Encryption Scheme Simplification

### What Changed

v5 had 5 encryption scheme identifiers. v6 has 3:

| v5 Scheme       | v6 Scheme    | Migration                                  |
| --------------- | ------------ | ------------------------------------------ |
| `whole-v1`      | `whole`      | **Re-encryption required** (v1 had no AAD) |
| `whole-v2`      | `whole`      | Rename only (already had AAD)              |
| `framed-v1`     | `framed`     | **Re-encryption required** (v1 had no AAD) |
| `framed-v2`     | `framed`     | Rename only (already had AAD)              |
| `convergent-v1` | `convergent` | Rename only                                |

### Why

Version suffixes on scheme names were compatibility cruft. AAD (Additional Authenticated Data) binding is now unconditional — every `whole` and `framed` manifest binds the slug to the ciphertext, preventing cross-manifest blob substitution attacks.

### What Happens if You Don't Migrate

Any call to `readManifest()`, `restore()`, `restoreFile()`, or `restoreStream()` on a v5 manifest will throw:

```
CasError: Legacy encryption scheme "framed-v1" is no longer supported.
Run scripts/migrate-encryption.js to upgrade this manifest.
[code: LEGACY_SCHEME]
```

### How to Migrate

```bash
# Dry-run: see what needs migration
npm run upgrade

# Execute: migrate all vault entries using stdin for the content passphrase
printf '%s\n' '<passphrase>' | npm run upgrade -- --execute --passphrase-file -

# Or read the content passphrase from a file
npm run upgrade -- --execute --passphrase-file ./content-passphrase.txt

# Or migrate entries encrypted with a raw 32-byte key
npm run upgrade -- --execute --key-file ./asset.key
```

The migration script has two modes:

- **Fast mode** (v2 schemes + convergent): renames the scheme in the manifest metadata. No re-encryption. Seconds.
- **Full mode** (v1 schemes): restores through the legacy pipeline (decrypts without AAD), then re-stores with the current scheme (encrypts with AAD). Requires exactly one content credential source: `--passphrase-file <path>`, `--key-file`, or inline `--passphrase` for compatibility.

Privacy-enabled vaults need the vault encryption key to list and update slugs.
If the vault passphrase differs from the content passphrase, pass
`--vault-passphrase-file`, `--vault-key-file`, or inline `--vault-passphrase`
for compatibility. When no explicit vault key option is provided, the content
passphrase from `--passphrase-file` or `--passphrase` is reused for the privacy
vault.

Inline `--passphrase` and `--vault-passphrase` remain accepted, but they print a
warning because command-line arguments can leak through shell history, process
listings, CI logs, and terminal transcripts.

Recipient-encrypted v1 manifests are not automatically full-migrated because
preserving recipient access requires the original recipient key set. Re-store
those assets with current recipients after restoring them with a matching
recipient key.

Original blobs are never deleted — Git's garbage collection only removes unreferenced objects after `git gc`.

### Vault Passphrase Verifier Migration

New encrypted vaults write `encryption.verifier` into `.vault.json`. The
verifier lets `git-cas` reject a wrong vault passphrase even when the encrypted
vault has no entries yet.

Existing encrypted vaults from older release candidates may not have verifier
metadata. They continue to work. The next vault write that provides the vault
encryption key, such as:

```bash
printf '%s\n' '<vault-passphrase>' \
  | git-cas store ./asset.bin --tree --slug assets/example --vault-passphrase-file -
```

adds the verifier automatically. If you are maintaining custom tooling that
derives vault keys manually, call `verifyVaultKey({ encryptionKey })` after
derivation. A result with `requiresMigration: true` means the vault predates the
verifier and the next keyed vault write will add it.

---

## Default Scheme Changes

### What Changed

| Scenario                    | v5 Default  | v6 Default   |
| --------------------------- | ----------- | ------------ |
| CDC chunking + encryption   | `framed-v1` | `convergent` |
| Fixed chunking + encryption | `framed-v1` | `framed`     |
| Explicit `whole`            | `whole-v1`  | `whole`      |

### What This Means

- **Convergent encryption** is now the default when using CDC chunking with encryption. This means deduplication works even with encrypted content — identical plaintext chunks produce identical ciphertext.
- If you were explicitly passing `encryption: { scheme: 'framed-v1' }`, change to `encryption: { scheme: 'framed' }`.
- If you were relying on the old default and want to keep framed encryption with CDC, pass `encryption: { scheme: 'framed' }` explicitly.

---

## API Changes

### Byte Types

Public byte-oriented APIs now use `Uint8Array` instead of Node-specific
`Buffer` types:

- `store({ source })` expects `AsyncIterable<Uint8Array>`.
- `restore()` returns `{ buffer: Uint8Array, bytesWritten }`.
- `restoreStream()` yields `Uint8Array` chunks.
- Port implementations for crypto, compression, chunking, persistence, and
  codecs should accept and return `Uint8Array`.

Node callers can still pass `Buffer` values because `Buffer` is a
`Uint8Array` subclass. Code that calls `buffer.equals(...)` on restore results
should compare with `Buffer.from(buffer).equals(...)` or use a runtime-neutral
byte comparison helper.

### CasService Constructor (Library Users)

**If you use `ContentAddressableStore` (the facade):** No changes needed. The facade handles all defaults.

**If you use `CasService` directly:**

```diff
- const service = new CasService({
-   persistence, codec, crypto, observability,
- });

+ import { FixedChunker, NodeCompressionAdapter } from '@git-stunts/git-cas';
+
+ const service = new CasService({
+   persistence, codec, crypto, observability,
+   chunker: new FixedChunker({ chunkSize: 256 * 1024 }),
+   compressionAdapter: new NodeCompressionAdapter(),
+ });
```

`chunker` and `compressionAdapter` are now **required**. They were previously optional with internal defaults — the defaults moved to the facade layer to keep the domain service free of infrastructure imports.

### New CryptoPort Methods

If you implement a custom `CryptoPort`, you must add these methods:

```js
// HMAC-SHA256 (used by vault privacy mode)
hmacSha256(key, data) { /* return 32-byte Uint8Array or Promise<Uint8Array> */ }

// Deterministic encryption (used by convergent encryption)
encryptBufferWithNonce(buffer, key, nonce) { /* return { buf, tag } */ }
decryptBufferWithNonceTag(buffer, key, nonce, tag) { /* return Uint8Array */ }
```

The shipped adapters (`NodeCryptoAdapter`, `BunCryptoAdapter`, `WebCryptoAdapter`) already implement these.

### Encryption Metadata Schema

Encrypted manifests now **require** the `scheme` field. Pre-v5.2 manifests that omitted `scheme` will fail schema validation. The migration script handles this.

### New Manifest Fields

- **`formatVersion`**: Semver string (e.g., `"6.0.0"`) stamped into new manifests. Identifies which library version wrote the manifest. Optional on read — old manifests without it still parse.
- **`manifestHash`**: SHA-256 of the codec-encoded manifest content. Verified on read. Catches corruption. Optional on read.

### New Exports

```js
// Standalone manifest diffing
import { diffManifests } from '@git-stunts/git-cas';

// Or as a static method
import ContentAddressableStore from '@git-stunts/git-cas';
ContentAddressableStore.diffManifests(oldManifest, newManifest);

// Compression port for custom adapters
import { CompressionPort, NodeCompressionAdapter } from '@git-stunts/git-cas';

// Scheme constants
import { SCHEME_WHOLE, SCHEME_FRAMED, SCHEME_CONVERGENT } from '@git-stunts/git-cas';
```

### Behavioral Changes

| Change                                   | Impact                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| Plaintext + gzip restore now streams     | This lowers memory usage and should be transparent.                                   |
| AAD always on for `whole` and `framed`   | Cannot opt out. v1-style no-AAD is gone.                                              |
| Manifest integrity hash verified on read | Corrupted manifests that previously loaded will now throw `MANIFEST_INTEGRITY_ERROR`. |
| KDF policy enforced in `deriveKey()`     | Dangerously weak params (e.g., 1 PBKDF2 iteration) now throw `KDF_POLICY_VIOLATION`.  |
| Concurrency capped at 64                 | Was unbounded. Unlikely to affect real usage.                                         |
| frameBytes capped at 64 MiB              | Was unbounded. Unlikely to affect real usage.                                         |

---

## New Features (Non-Breaking)

These are new capabilities that don't require migration:

- **Convergent encryption** — CDC dedup works with encryption
- **FastCDC dual-mask normalization** — tighter chunk size distribution (default on)
- **Manifest integrity hash** — SHA-256 checksum on manifests
- **Vault privacy mode** — HMAC-hashed slug names
- **Manifest diffing** — compare two manifests by chunk digest
- **Parallel chunk restore** — prefetch window for concurrent reads
- **CompressionPort** — pluggable compression (shipped: gzip via NodeCompressionAdapter)
- **ConvergentEncryption service** — extracted domain service
- **PrefetchWindow** — ordered parallel read primitive
- **Scheme truth module** — `src/domain/encryption/schemes.js`

---

## Troubleshooting

### `LEGACY_SCHEME` error on restore

```
CasError: Legacy encryption scheme "whole-v1" is no longer supported.
```

Run `printf '%s\n' '<pass>' | npm run upgrade -- --execute --passphrase-file -`
or
`npm run upgrade -- --execute --key-file <path>` to migrate.

### `KDF_POLICY_VIOLATION` on deriveKey

```
CasError: deriveKey KDF field "iterations" must be between 100000 and 2000000
```

v6 enforces minimum KDF parameters. Increase iterations to at least 100,000 (PBKDF2) or cost to at least 16,384 (scrypt).

### `MANIFEST_INTEGRITY_ERROR` on readManifest

```
CasError: Manifest integrity check failed: hash mismatch
```

The manifest blob was corrupted or tampered with after storage. The original data may still be recoverable from Git's object database if the corruption was in the tree, not the blob.

### Constructor throws "chunker is required"

You're using `CasService` directly. Either switch to the `ContentAddressableStore` facade (recommended) or inject a `chunker` and `compressionAdapter` manually. See [API Changes](#casservice-constructor-library-users).
