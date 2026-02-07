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
- **Chunked storage** big files become stable, reusable blobs.
- **Optional AES-256-GCM encryption** store secrets without leaking plaintext into the ODB.
- **Compression** gzip before encryption — smaller blobs, same round-trip.
- **Passphrase encryption** derive keys from passphrases via PBKDF2 or scrypt — no raw key management.
- **Merkle manifests** large files auto-split into sub-manifests for scalability.
- **Manifests** a tiny explicit index of chunks + metadata (JSON/CBOR).
- **Tree output** generates standard Git trees so assets snap into commits cleanly.
- **Full round-trip** store, tree, and restore — get your bytes back, verified.
- **Lifecycle management** `readManifest`, `deleteAsset`, `findOrphanedChunks` — inspect trees, plan deletions, audit storage.

**Use it for:** binary assets, build artifacts, model weights, data packs, secret bundles, weird experiments, etc.

## What's new in v2.0.0

**Compression** — `compression: { algorithm: 'gzip' }` on `store()`. Compression runs before encryption. Decompression on `restore()` is automatic.

**Passphrase-based encryption** — Pass `passphrase` instead of `encryptionKey`. Keys are derived via PBKDF2 (default) or scrypt. KDF parameters are stored in the manifest for deterministic re-derivation. Use `deriveKey()` directly for manual control.

**Merkle tree manifests** — When chunk count exceeds `merkleThreshold` (default: 1000), manifests are automatically split into sub-manifests stored as separate blobs. `readManifest()` transparently reconstitutes them. Full backward compatibility with v1 manifests.

See [CHANGELOG.md](./CHANGELOG.md) for the full list of changes.

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

# Store and get a tree OID directly
git cas store ./image.png --slug my-image --tree

# Create a tree from an existing manifest
git cas tree --manifest manifest.json

# Restore from a tree OID
git cas restore <tree-oid> --out ./restored.png

# Encrypted round-trip (32-byte raw key file)
git cas store ./secret.bin --slug vault --key-file ./my.key --tree
git cas restore <tree-oid> --out ./decrypted.bin --key-file ./my.key
```

## Why not Git LFS?

Because sometimes you want the Git object database to be the store:

- deterministic 
- content-addressed 
- locally replicable 
- commit-addressable

Also because LFS is, well... LFS.

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
