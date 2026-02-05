# @git-stunts/git-cas

**Git, freebased: pure CAS that’ll knock your SHAs off. LFS hates this repo.**

Git isn’t “source control.” Git is a content-addressed object database wearing a VCS UI.
This project stops pretending and uses the database part.

`git-cas` chunks files into Git blobs (dedupe for free), optionally encrypts them, and emits a
manifest + a real Git tree so you can commit/tag/ref it like any other artifact.

---

## What you get

- **Dedupe for free** — Git already hashes objects. We just lean into it.
- **Chunked storage** — big files become stable, reusable blobs.
- **Optional AES-256-GCM encryption** — store secrets without leaking plaintext into the ODB.
- **Manifests** — a tiny, explicit index of chunks + metadata (JSON/CBOR).
- **Tree output** — generate standard Git trees so assets snap into commits cleanly.

---

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

// Now you can point a ref/commit at that tree like a normal Git artifact.


⸻

CLI (git plugin)

If you install the CLI, it shows up as:

git cas store ./image.png --slug my-image
git cas tree  --slug my-image
git cas restore <tree-oid> --out ./image.png

(Actual subcommands depend on what you ship first — but that’s the intended shape.)

⸻

Why not just use Git LFS?

Because you don't need LFS. Git has always been an object database. Git is already deterministic, content-addressed, locally replicable, and commit-addressable. Also, because LFS is... LFS.
