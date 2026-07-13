# git-cas

> Modern open-source systems still rely on centralized infrastructure to distribute binary artifacts, even when their source code is fully decentralized. This creates a fragile dependency: if hosting endpoints are blocked, degraded, or removed, critical artifacts become unavailable or unverifiable.
>
> `git-cas` addresses this by making artifact distribution inherit Git’s existing replication model, allowing binaries to be stored, verified, and transported anywhere Git can operate, including mirrored networks, constrained environments, or fully offline contexts.

`git-cas` is an industrial-grade Content-Addressable Storage (CAS) engine backed by Git’s object database. Its Security First posture makes explicit restore boundaries, bounded metadata reads, authenticated encryption, and legacy-scheme rejection the default. Stored content is chunked, deduplicated, and optionally encrypted — keeping high-fidelity assets and security-sensitive files directly within your repository history.

`git-cas` is designed for the architect who demands mathematical certainty and the operator who needs a stable foundation for artifact storage. It scales from simple binary blob management to multi-recipient envelope-encrypted vaults with key rotation, privacy-mode slug hashing, and Merkle-style manifests for assets of any size.

[![npm version](https://img.shields.io/npm/v/@git-stunts/git-cas)](https://www.npmjs.com/package/@git-stunts/git-cas)
[![License](https://img.shields.io/github/license/git-stunts/git-cas)](./LICENSE)

![git-cas demo](./docs/demo.gif)

## Why git-cas?

Unlike traditional LFS which moves files to external servers, `git-cas` treats the Git object database as a first-class storage substrate.

- **Deduplication by Default**: Content-defined chunking (CDC) with Buzhash rolling hash identifies repeated patterns across files and versions, minimizing repository growth.
- **Cryptographic Trust**: Every chunk is verified against a SHA-256 digest. Optional AES-256-GCM encryption with multi-recipient envelope support ensures privacy at rest, and `framed` binds per-frame AAD to prevent cross-manifest blob swaps.
- **GC-Safe Vault**: Named assets are indexed through a stable ref (`refs/cas/vault`) with optimistic concurrency, preventing Git garbage collection from reclaiming referenced blobs.
- **Mutable Root Sets**: Cache and derived-state trees can be anchored under
  `refs/cas/rootsets/*` while live, then become collectible after eviction,
  without vault history retaining every prior generation.
- **Opaque Application Handles**: Applications stage assets, immutable pages,
  and deterministic structured bundles through validated handles, then retain
  or publish them with generation-scoped evidence instead of managing Git
  objects, trees, or payload OIDs directly.
- **Key Lifecycle**: Envelope encryption separates DEKs from KEKs. Rotate passphrases across an entire vault without re-encrypting data blobs. Privacy mode HMAC-hashes slug names to prevent metadata discovery.
- **Runtime-Adaptive**: A single core supports Node.js 22+, Bun, and Deno through a strict hexagonal port architecture with runtime-specific crypto adapters.

## Quick Start

Existing v5 users should read [UPGRADING.md](./UPGRADING.md) and run
`npm run upgrade` in dry-run mode before restoring old encrypted vault entries.
For the release overview, see the
[v6.1.0 Release Notes](./docs/releases/v6.1.0.md).

### 1. CLI Usage

Initialize a vault and store your first asset.

```bash
git init
git-cas vault init
git-cas store data.bin --slug assets/v1 --tree
git-cas restore --slug assets/v1 --out data-restored.bin
```

### 2. TUI Cockpit

Navigate your stored assets through the reader-first interactive dashboard.

```bash
git-cas vault dashboard
```

### 3. Library Ingress

Integrate managed blob storage directly into your TypeScript or JavaScript application.

```js
import { createReadStream } from 'node:fs';
import ContentAddressableStore from '@git-stunts/git-cas';

const cas = await ContentAddressableStore.open({ cwd: '.' });
const staged = await cas.assets.put({
  source: createReadStream('./asset.bin'),
  slug: 'app/asset',
  filename: 'asset.bin',
});
const retained = await cas.retention.retain({
  handle: staged.handle,
  root: { ref: 'refs/cas/rootsets/my-app', name: 'app/asset' },
  policy: 'pinned',
});
```

`staged.handle` is a content locator, not a durability promise. The returned
retention witness identifies the exact Git generation and tree edge that made
the asset reachable.

## Capability Map

The README is the front door. Detailed mechanics live in the guide set:

| Need                                                    | Start Here                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| Productive library and CLI workflows                    | [Developer Guide](./GUIDE.md)                                |
| Restore memory behavior                                 | [Streaming and restore matrix](./GUIDE.md#streaming-surface) |
| Encryption scheme selection                             | [Encryption Modes](./docs/ENCRYPTION_MODES.md)               |
| CDC internals, Merkle manifests, KDF policy, and tuning | [Advanced Guide](./ADVANCED_GUIDE.md)                        |
| Ports, adapters, and collaborator boundaries            | [Architecture](./ARCHITECTURE.md)                            |
| Assets, pages, bundles, retention, and publication      | [Application storage](./docs/API.md#application-storage)     |
| GC retention for caches and derived state               | [Root Sets](./docs/API.md#root-sets)                         |
| v5 to v6 migration                                      | [Upgrading](./UPGRADING.md)                                  |

Core capabilities:

- **Content-addressed storage**: chunks are addressed by SHA-256 digest and
  integrity-verified on read.
- **Deduplication**: fixed chunking and content-defined chunking (CDC) support
  predictable or shift-resistant chunk boundaries.
- **Encryption**: AES-256-GCM with authenticated metadata. `whole` and
  `framed` use fresh random 96-bit nonces; `convergent` derives per-chunk keys
  and nonces deterministically from the plaintext content hash to preserve
  deduplication.
- **Vault indexing**: named assets live under `refs/cas/vault` so Git garbage
  collection does not reclaim referenced blobs.
- **Root-set retention**: current cache entries live under caller-owned
  `refs/cas/rootsets/*` refs. Entries are Git-reachable while present, and old
  set generations are not retained as commit history.
- **Application storage**: `assets`, `pages`, `bundles`, `retention`, and
  `publications` compose streaming CAS writes, bounded structured
  materializations, targeted member reads, reachability roots,
  compare-and-swap refs, and immutable lifecycle evidence.
- **Envelope recipients**: multi-recipient key wrapping and recipient rotation
  avoid re-encrypting data blobs.
- **Operational diagnostics**: `git-cas doctor` validates vault health and
  reports deduplication efficiency.

## Safety Snapshot

The v6 line is Security First by default:

- `restoreFile()` requires `baseDirectory` and refuses output paths that escape
  it.
- Manifest and sub-manifest blob reads default to a 10 MiB `maxBlobSize` safety
  limit.
- Legacy encryption scheme identifiers throw `LEGACY_SCHEME` with migration
  guidance.
- KDF parameters, salts, frame sizes, restore buffers, and concurrency are
  policy-bounded.
- Recipient trial decryption and vault verifier checks use constant-time
  comparisons.

For the full hardening table, see
[Advanced Guide: Security Hardening Summary](./ADVANCED_GUIDE.md#security-hardening-summary).

## Runtime Support

| Runtime     | Version | Crypto Backend       | Status                                               |
| ----------- | ------- | -------------------- | ---------------------------------------------------- |
| **Node.js** | 22+     | `node:crypto`        | Primary — full streaming support                     |
| **Bun**     | Latest  | `node:crypto` compat | Tested via Docker                                    |
| **Deno**    | Latest  | Web Crypto API       | Tested via Docker; `whole` decrypt is bounded-buffer |

All three runtimes are tested in CI on every push. The hexagonal architecture isolates runtime differences behind the `CryptoPort` boundary, so the domain core is runtime-agnostic.

## Documentation

- **[Guide](./GUIDE.md)**: Productive path, library/CLI usage, vault workflows, and the feature coverage map.
- **[Advanced Guide](./ADVANCED_GUIDE.md)**: CDC internals, direct service contracts, security limits, operational tooling, and performance baselines.
- **[Architecture](./ARCHITECTURE.md)**: The authoritative system map — Facade, Domain, Ports, and Adapters.
- **[Extending](./docs/EXTENDING.md)**: Custom adapter contracts and extension-point checklist.
- **[Store/Restore Pipeline](./docs/STORE_RESTORE_PIPELINE.md)**: Maintainer state machines for byte storage, restore, tree publication, and vault boundaries.
- **[Vault Internals](./docs/VAULT_INTERNALS.md)**: Maintainer map for vault persistence, caching, codecs, privacy indexing, key verification, and retry policy.
- **[Security](./SECURITY.md)**: Threat models, trust boundaries, and encryption internals.
- **[Agent API](./docs/API.md)**: JSONL agent protocol for CI/CD automation.
- **[Workflow](https://github.com/git-stunts/git-cas/blob/main/WORKFLOW.md)**: Repo work doctrine, cycles, and invariants.
- **[Contributing](https://github.com/git-stunts/git-cas/blob/main/CONTRIBUTING.md)**, **[Code of Conduct](./CODE_OF_CONDUCT.md)**, and **[Support](./SUPPORT.md)**: Project participation and help paths.
- **[v6.0.0 Release Notes](./docs/releases/v6.0.0.md)**: Major-release summary, upgrade call-to-action, and publication notes.
- **[v6.1.0 Release Notes](./docs/releases/v6.1.0.md)**: Root-set retention,
  doctor/repair, and GC-policy guidance.
- **[Upgrading](./UPGRADING.md)**: Migration guide for v5 → v6.
- **[Changelog](./CHANGELOG.md)**: Version history and migration notes.

---

Built with terminal ambition by [FLYING ROBOTS](https://github.com/flyingrobots)
