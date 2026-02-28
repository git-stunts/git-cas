# @git-stunts/git-cas

<img width="420" alt="git-cas" src="https://github.com/user-attachments/assets/e7cb63b9-25b7-4369-b053-4a35962ccee4" />

## JESSIE, STOP—

> Hold on. He’s turning Git into a blob store. Let him cook.

**Most potent clone available on GitHub (legally).**

### Git, freebased: pure CAS that’ll knock your SHAs off. LFS hates this repo.

Git isn’t source control. 
Git is a content-addressed object database.  
We use the object database.  

`git-cas` chunks files into Git blobs (dedupe for free), optionally encrypts them, and emits a manifest + a real Git tree so you can commit/tag/ref it like any other artifact.

## What you get

- **Dedupe for free** Git already hashes objects. We just lean into it.
- **Chunked storage** big files become stable, reusable blobs. Fixed-size or content-defined chunking (CDC).
- **Optional AES-256-GCM encryption** store secrets without leaking plaintext into the ODB.
- **Multi-recipient encryption** envelope model (DEK/KEK) — add/remove access without re-encrypting data.
- **Compression** gzip before encryption — smaller blobs, same round-trip.
- **Passphrase encryption** derive keys from passphrases via PBKDF2 or scrypt — no raw key management.
- **Merkle manifests** large files auto-split into sub-manifests for scalability.
- **Manifests** a tiny explicit index of chunks + metadata (JSON/CBOR).
- **Tree output** generates standard Git trees so assets snap into commits cleanly.
- **Full round-trip** store, tree, and restore — get your bytes back, verified.
- **Lifecycle management** `readManifest`, `deleteAsset`, `findOrphanedChunks` — inspect trees, plan deletions, audit storage.
- **Vault** GC-safe ref-based storage. One ref (`refs/cas/vault`) indexes all assets by slug. No more silent data loss from `git gc`.
- **Interactive dashboard** `git cas inspect` with chunk heatmap, animated progress bars, and rich manifest views.
- **Verify & JSON output** `git cas verify` checks integrity; `--json` on all commands for CI/scripting.

**Use it for:** binary assets, build artifacts, model weights, data packs, secret bundles, weird experiments, etc.

<img src="./docs/demo.gif" alt="git-cas demo" />

## What's new in v5.1.0

**Multi-recipient envelope encryption** — Each file is encrypted with a random DEK; recipient KEKs wrap the DEK. Add or remove team members without re-encrypting data.

```js
// API: store for multiple recipients
const manifest = await cas.storeFile({
  filePath: './secrets.tar.gz',
  slug: 'prod-secrets',
  recipients: [
    { label: 'alice', key: aliceKey },
    { label: 'bob', key: bobKey },
  ],
});

// Add a recipient later (no re-encryption)
const updated = await cas.addRecipient({
  manifest, existingKey: aliceKey, newRecipientKey: carolKey, label: 'carol',
});

// List / remove recipients
const labels = await cas.listRecipients({ manifest });
const trimmed = await cas.removeRecipient({ manifest, label: 'bob' });
```

```bash
# CLI: store with multiple recipients
git cas store ./secrets.tar.gz --slug prod-secrets \
  --recipient alice:./keys/alice.key \
  --recipient bob:./keys/bob.key --tree

# Manage recipients
git cas recipient list prod-secrets
git cas recipient add prod-secrets --label carol --key-file ./keys/carol.key --existing-key-file ./keys/alice.key
git cas recipient remove prod-secrets --label bob
```

See [CHANGELOG.md](./CHANGELOG.md) for the full list of changes.

## What's new in v5.0.0

**Content-defined chunking (CDC)** — Fixed-size chunking invalidates every chunk after an edit. CDC uses a buzhash rolling hash to find natural boundaries, limiting the blast radius to 1–2 chunks. Benchmarked at 98.4% chunk reuse on small edits vs 32% for fixed.

```js
const cas = new ContentAddressableStore({
  plumbing,
  chunking: { strategy: 'cdc', targetChunkSize: 262144, minChunkSize: 65536, maxChunkSize: 1048576 },
});
```

**`ChunkingPort`** — new hexagonal port abstracts chunking strategy. `FixedChunker` and `CdcChunker` adapters ship out of the box. Bring your own chunker by extending `ChunkingPort`.

See [CHANGELOG.md](./CHANGELOG.md) for the full list of changes.

## What's new in v4.0.1

**`git cas verify`** — verify stored asset integrity from the CLI without restoring (`git cas verify --slug my-asset`).

**`--json` everywhere** — all commands now support `--json` for structured output. Pipe `git cas vault list --json | jq` in CI.

**CryptoPort base class** — shared key validation, metadata building, and KDF normalization. All three adapters (Node/Bun/Web) inherit from a single source of truth.

**Centralized error handling** — `runAction` wrapper with CasError codes and actionable hints (e.g., "Provide --key-file or --vault-passphrase").

**Vault list filtering** — `git cas vault list --filter "photos/*"` with TTY-aware table formatting.

See [CHANGELOG.md](./CHANGELOG.md) for the full list of changes.

## What's new in v4.0.0

**ObservabilityPort** — `CasService` no longer extends `EventEmitter`. A new hexagonal `ObservabilityPort` decouples the domain from Node's event infrastructure. Three adapters ship out of the box: `SilentObserver` (no-op default), `EventEmitterObserver` (backward-compatible event bridge), and `StatsCollector` (metric accumulator).

**Streaming restore** — `restoreStream()` returns an `AsyncIterable<Buffer>` with O(chunkSize) memory for unencrypted files. `restoreFile()` now writes via `createWriteStream` + `pipeline` instead of buffering.

**Parallel chunk I/O** — new `concurrency` option gates store writes and restore reads through a counting semaphore. `concurrency: 4` can significantly speed up large-file operations.

See [CHANGELOG.md](./CHANGELOG.md) for the full list of changes.

## What's new in v3.1.0

**Interactive vault dashboard** — `git cas inspect --slug my-asset` renders a rich TUI with chunk heatmap, encryption card, and history timeline. Animated progress bars for long store/restore operations.

See [CHANGELOG.md](./CHANGELOG.md) for the full list of changes.

## What's new in v3.0.0

**Vault** — GC-safe ref-based storage under `refs/cas/vault`. Assets are indexed by slug and survive `git gc`. Full CLI: `git cas vault init`, `list`, `info`, `remove`, `history`. Store with `--tree` to vault automatically.

See [CHANGELOG.md](./CHANGELOG.md) for the full list of changes.

## What's new in v2.0.0

**Compression** — `compression: { algorithm: 'gzip' }` on `store()`. Compression runs before encryption. Decompression on `restore()` is automatic.

**Passphrase-based encryption** — Pass `passphrase` instead of `encryptionKey`. Keys are derived via PBKDF2 (default) or scrypt. KDF parameters are stored in the manifest for deterministic re-derivation. Use `deriveKey()` directly for manual control.

**Merkle tree manifests** — When chunk count exceeds `merkleThreshold` (default: 1000), manifests are automatically split into sub-manifests stored as separate blobs. `readManifest()` transparently reconstitutes them. Full backward compatibility with v1 manifests.

See [CHANGELOG.md](./CHANGELOG.md) for the full list of changes.

## Install

```bash
npm install @git-stunts/git-cas
```

```bash
npx jsr add @git-stunts/git-cas
```

## Usage (Node API)

```js
import GitPlumbing from '@git-stunts/plumbing';
import ContentAddressableStore from '@git-stunts/cas';

const git = new GitPlumbing({ cwd: './assets-repo' });
const cas = new ContentAddressableStore({ plumbing: git });

// Store a file -> returns a manifest (chunk list + metadata)
const manifest = await cas.storeFile({
  filePath: './image.png',
  slug: 'my-image',
  encryptionKey: myKeyBuffer, // optional (32 bytes)
});

// Turn the manifest into a Git tree OID
const treeOid = await cas.createTree({ manifest });

// Restore later — get your bytes back, integrity-verified
await cas.restoreFile({ manifest, outputPath: './restored.png' });

// Read the manifest back from a tree OID
const m = await cas.readManifest({ treeOid });

// Lifecycle: inspect deletion impact, find orphaned chunks
const { slug, chunksOrphaned } = await cas.deleteAsset({ treeOid });
const { referenced, total } = await cas.findOrphanedChunks({ treeOids: [treeOid] });

// v2.0.0: Compressed + passphrase-encrypted store
const manifest2 = await cas.storeFile({
  filePath: './image.png',
  slug: 'my-image',
  passphrase: 'my secret passphrase',
  compression: { algorithm: 'gzip' },
});
```

## CLI (git plugin)

`git-cas` installs as a Git subcommand:

```bash
# Store a file — prints manifest JSON
git cas store ./image.png --slug my-image

# Store and vault the tree OID (GC-safe)
git cas store ./image.png --slug my-image --tree

# Restore from a vault slug
git cas restore --slug my-image --out ./restored.png

# Restore from a direct tree OID
git cas restore --oid <tree-oid> --out ./restored.png

# Verify integrity without restoring
git cas verify --slug my-image

# Inspect manifest (interactive dashboard)
git cas inspect --slug my-image

# Vault management
git cas vault init
git cas vault list                        # TTY table
git cas vault list --json                 # structured JSON
git cas vault list --filter "photos/*"    # glob filter
git cas vault info my-image
git cas vault remove my-image
git cas vault history

# Multi-recipient encryption
git cas store ./secret.bin --slug shared \
  --recipient alice:./keys/alice.key \
  --recipient bob:./keys/bob.key --tree
git cas recipient list shared
git cas recipient add shared --label carol --key-file ./keys/carol.key --existing-key-file ./keys/alice.key
git cas recipient remove shared --label bob

# Encrypted vault round-trip (passphrase via env var or --vault-passphrase flag)
export GIT_CAS_PASSPHRASE="secret"
git cas vault init
git cas store ./secret.bin --slug vault-entry --tree
git cas restore --slug vault-entry --out ./decrypted.bin

# JSON output on any command (for CI/scripting)
git cas store ./data.bin --slug my-data --tree --json
```

## Documentation

- [Guide](./GUIDE.md) — progressive walkthrough
- [API Reference](./docs/API.md) — full method documentation
- [Architecture](./ARCHITECTURE.md) — hexagonal design overview
- [Security](./docs/SECURITY.md) — crypto design and threat model

## When to use git-cas (and when not to)

### "I just want screenshots in my README"

Use an **orphan branch**. Seriously. It's 5 git commands, zero dependencies, and GitHub renders the images inline. Google "git orphan branch assets" — that's all you need. git-cas is overkill for public images and demo GIFs.

### "I need encrypted secrets / large binaries / deduplicated assets in a Git repo"

That's git-cas. The orphan branch gives you none of:

| | Orphan branch | git-cas |
|---|---|---|
| **Encryption** | None — plaintext forever in history | AES-256-GCM + passphrase KDF + multi-recipient |
| **Large files** | Bloats `git clone` for everyone | Chunked, restored on demand |
| **Dedup** | None | Chunk-level content addressing |
| **Integrity** | Git SHA-1 | SHA-256 per chunk + GCM auth tag |
| **Lifecycle** | `git rm` (still in reflog) | Vault with audit trail + `git gc` reclaims |
| **Compression** | None | gzip before encryption |

### "Why not Git LFS?"

Because sometimes you want the Git object database to be the store — deterministic, content-addressed, locally replicable, commit-addressable — with no external server, no LFS endpoint, and no second system to manage.

If your team uses GitHub and needs file locking + web UI previews, use LFS. If you want encrypted, self-contained, server-free binary storage that travels with `git clone`, use git-cas.

---

> _THIS HASH’LL KNOCK YOUR SHAs OFF! FIRST COMMIT’S FREE, MAN._

<img width="420" alt="dhtux" src="https://github.com/user-attachments/assets/f2c13357-22c7-4685-83ce-7eccd747e2fe" />

---

## License

Apache-2.0 
Copyright © 2026 [James Ross](https://github.com/flyingrobots)

---

<p align="center">
<sub>Built by <a href="https://github.com/flyingrobots">FLYING ROBOTS</a></sub>
</p>
