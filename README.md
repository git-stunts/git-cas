# git-cas

An industrial-grade Content-Addressable Storage (CAS) engine backed by Git's object database. Stored content is chunked, deduplicated, and optionally encrypted—keeping high-fidelity assets and security-sensitive files directly within your repository history.

`git-cas` is designed for the architect who demands mathematical certainty and the operator who needs a stable foundation for artifact storage. It scales from simple binary blob management to multi-recipient envelope-encrypted vaults.

[![npm version](https://img.shields.io/npm/v/@git-stunts/git-cas)](https://www.npmjs.com/package/@git-stunts/git-cas)
[![JSR version](https://jsr.io/badges/@git-stunts/git-cas)](https://jsr.io/@git-stunts/git-cas)
[![License](https://img.shields.io/github/license/git-stunts/git-cas)](./LICENSE)

![git-cas demo](./docs/demo.gif)

## Why git-cas?

Unlike traditional LFS which moves files to external servers, `git-cas` treats the Git object database as a first-class storage substrate.

- **Deduplication by Default**: Content-defined chunking (CDC) identifies repeated patterns across files and versions, minimizing repository growth.
- **Cryptographic Trust**: Stored content is verified against SHA-256 manifests. Optional AES-256-GCM encryption with multi-recipient envelope support ensures privacy at rest.
- **GC-Safe Vault**: Named assets are indexed through a stable ref (`refs/cas/vault`), preventing Git garbage collection from reclaiming referenced blobs.
- **Runtime-Adaptive**: A single core supports Node.js, Bun, and Deno through a strict hexagonal port architecture.

## Quick Start

### 1. CLI Usage
Initialize a vault and store your first asset.
```bash
git init
git-cas vault init
git-cas store data.bin --slug assets/v1 --tree
```

### 2. TUI Cockpit
Navigate your stored assets through the reader-first interactive dashboard.
```bash
git-cas vault dashboard
```

### 3. Library Ingress
Integrate managed blob storage directly into your TypeScript or JavaScript application.
```js
import GitPlumbing from '@git-stunts/plumbing';
import ContentAddressableStore from '@git-stunts/git-cas';

const plumbing = new GitPlumbing({ cwd: '.' });
const cas = ContentAddressableStore.createJson({ plumbing });

const manifest = await cas.storeFile({ filePath: './asset.bin', slug: 'app/asset' });
const treeOid = await cas.createTree({ manifest });
```

## Streaming Surface

| Surface | Streaming API? | Non-streaming API? | Notes |
|---|---|---|---|
| Write | `store({ source, ... })`, `storeFile(...)` | No dedicated non-streaming store facade | Write ingress is stream-based. `whole-v1` writes through the crypto stream path; `framed-v1` writes framed records incrementally and stays bounded by `frameBytes`. |
| Read: plaintext | `restoreStream(...)`, `restoreFile(...)` | `restore(...)` | True chunk-by-chunk streaming restore. |
| Read: encrypted `whole-v1` | `restoreStream(...)`, `restoreFile(...)` | `restore(...)` | `restoreStream()` is still the buffered compatibility path. `restoreFile()` now uses a bounded temp-file path: it verifies chunks, streams tentative plaintext through whole-object AES-GCM decryption, and renames into place only after auth succeeds. On Web Crypto runtimes this decrypt step is still one-shot internally, but it is now bounded by `maxDecryptionBufferSize` instead of collecting ciphertext without a limit. |
| Read: encrypted `framed-v1` | `restoreStream(...)`, `restoreFile(...)` | `restore(...)` | True authenticated streaming restore. Plaintext is yielded frame-by-frame after each frame is verified. |
| Read: compressed-only | `restoreStream(...)`, `restoreFile(...)` | `restore(...)` | `restoreStream()` still buffers gzip restore today. `restoreFile()` now uses a bounded temp-file path and streams gunzip output into place. |
| Read: compressed + `whole-v1` | `restoreStream(...)`, `restoreFile(...)` | `restore(...)` | `restoreStream()` is still buffered because auth completes at the end of whole-object AES-GCM. `restoreFile()` now decrypts and gunzips through the same bounded temp-file path. |
| Read: compressed + `framed-v1` | `restoreStream(...)`, `restoreFile(...)` | `restore(...)` | Streaming decrypt, then streaming gunzip. |
| Verify | No streaming verify surface | `verifyIntegrity(manifest, options?)` | Verifies chunk digests for all content. `whole-v1` auth-checks the full ciphertext; `framed-v1` parses and auth-checks every frame. |

Runtime note: `framed-v1` is the honest cross-runtime streaming answer. On
Node and Bun, `whole-v1 restoreFile()` has the stronger low-memory path; on
Web Crypto runtimes such as Deno, `whole-v1` remains bounded-buffer rather
than true streaming.

## Documentation

- **[Guide](./docs/GUIDE.md)**: Orientation, long-form walkthrough, and vault management.
- **[Advanced Guide](./docs/BENCHMARKS.md)**: Performance baselines, CDC tuning, and large-asset Merkle trees.
- **[Architecture](./ARCHITECTURE.md)**: The authoritative system map (Facade, Domain, Ports).
- **[Security](./SECURITY.md)**: Threat models, trust boundaries, and encryption internals.
- **[Workflow](./WORKFLOW.md)**: Repo work doctrine, cycles, and invariants.

---
Built with terminal ambition by [FLYING ROBOTS](https://github.com/flyingrobots)
