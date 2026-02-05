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
- **Manifests** a tiny explicit index of chunks + metadata (JSON/CBOR).
- **Tree output** generates standard Git trees so assets snap into commits cleanly.

**Use it for:** binary assets, build artifacts, model weights, data packs, secret bundles, weird experiments, etc.

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
const treeOid = cas.createTree({ manifest });

// Now you can point a ref/commit at that tree like a normal Git artifact.
```

## CLI (git plugin)

`git-cas` installs as a Git subcommand:

```bash
git cas store   ./image.png --slug my-image
git cas tree    --slug my-image
git cas restore <tree-oid> --out ./image.png
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
