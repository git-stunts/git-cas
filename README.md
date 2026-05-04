# git-cas

> Modern open-source systems still rely on centralized infrastructure to distribute binary artifacts, even when their source code is fully decentralized. This creates a fragile dependency: if hosting endpoints are blocked, degraded, or removed, critical artifacts become unavailable or unverifiable.
>
> `git-cas` addresses this by making artifact distribution inherit Git’s existing replication model, allowing binaries to be stored, verified, and transported anywhere Git can operate, including mirrored networks, constrained environments, or fully offline contexts.

`git-cas` 6.0.0 is an industrial-grade Content-Addressable Storage (CAS) engine backed by Git’s object database. Stored content is chunked, deduplicated, and optionally encrypted — keeping high-fidelity assets and security-sensitive files directly within your repository history.

`git-cas` is designed for the architect who demands mathematical certainty and the operator who needs a stable foundation for artifact storage. It scales from simple binary blob management to multi-recipient envelope-encrypted vaults with key rotation, privacy-mode slug hashing, and Merkle-style manifests for assets of any size.

[![npm version](https://img.shields.io/npm/v/@git-stunts/git-cas)](https://www.npmjs.com/package/@git-stunts/git-cas)
[![JSR version](https://jsr.io/badges/@git-stunts/git-cas)](https://jsr.io/@git-stunts/git-cas)
[![License](https://img.shields.io/github/license/git-stunts/git-cas)](./LICENSE)

![git-cas demo](./docs/demo.gif)

## Why git-cas?

Unlike traditional LFS which moves files to external servers, `git-cas` treats the Git object database as a first-class storage substrate.

- **Deduplication by Default**: Content-defined chunking (CDC) with Buzhash rolling hash identifies repeated patterns across files and versions, minimizing repository growth.
- **Cryptographic Trust**: Every chunk is verified against a SHA-256 digest. Optional AES-256-GCM encryption with multi-recipient envelope support ensures privacy at rest, and `framed` binds per-frame AAD to prevent cross-manifest blob swaps.
- **GC-Safe Vault**: Named assets are indexed through a stable ref (`refs/cas/vault`) with optimistic concurrency, preventing Git garbage collection from reclaiming referenced blobs.
- **Key Lifecycle**: Envelope encryption separates DEKs from KEKs. Rotate passphrases across an entire vault without re-encrypting data blobs. Privacy mode HMAC-hashes slug names to prevent metadata discovery.
- **Runtime-Adaptive**: A single core supports Node.js 22+, Bun, and Deno through a strict hexagonal port architecture with runtime-specific crypto adapters.

## Quick Start

### 1. CLI Usage

Initialize a vault and store your first asset.

```bash
git init
git-cas vault init
git-cas store data.bin --slug assets/v1 --tree
git-cas restore assets/v1 --output data-restored.bin
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

const plumbing = GitPlumbing.createDefault({ cwd: '.' });
const cas = ContentAddressableStore.createJson({ plumbing });

const manifest = await cas.storeFile({ filePath: './asset.bin', slug: 'app/asset' });
const treeOid = await cas.createTree({ manifest });
```

## Feature Overview

### Content-Addressed Storage

Every piece of stored content is broken into chunks and addressed by its SHA-256 digest. Identical content always produces the same address, giving you deduplication for free. Manifests record the ordered list of chunk digests so content can be reassembled faithfully, and every chunk is integrity-verified on read. New manifests are stamped with a `formatVersion` (semver from package.json) for forward-compatible schema evolution.

### Chunking

Two chunking strategies are available, both with configurable size parameters:

| Strategy | Algorithm | Default Target | Behavior |
|---|---|---|---|
| **Fixed-size** | Static split | 256 KiB | Deterministic, predictable chunk boundaries |
| **Content-Defined (CDC)** | Buzhash rolling hash | Configurable target/min/max | Shift-resistant boundaries that survive insertions and deletions |

CDC is the default for deduplication workloads. **FastCDC dual-mask normalization** is enabled by default, producing a tighter chunk-size distribution around the target size. Target, minimum, and maximum chunk sizes are all configurable.

### Encryption

All encryption uses **AES-256-GCM** with 12-byte random nonces and 16-byte authentication tags.

Three encryption schemes are supported:

| Scheme | Framing | AAD Binding | Notes |
|---|---|---|---|
| `whole` | Single ciphertext blob | Slug | AAD always bound to prevent cross-manifest blob swaps |
| `framed` | Bounded frames | Slug + frame index | Default for fixed-chunk encrypted stores — streaming decrypt with per-frame AAD binding |
| `convergent` | Per-chunk deterministic | Derived from content hash | **Default for CDC + encryption** — preserves deduplication across encrypted stores. Implemented as a standalone `ConvergentEncryption` service. |

Legacy schemes (`whole-v1`, `whole-v2`, `framed-v1`, `framed-v2`, `convergent-v1`) are no longer accepted and throw a `LEGACY_SCHEME` error. Run `npm run upgrade` (or `node scripts/migrate-encryption.js`) to migrate existing vault entries. The script auto-detects whether each entry needs a rename-only (fast) or full re-encryption (v1 schemes without AAD) and defaults to dry-run mode.

**Envelope encryption** wraps a random Data Encryption Key (DEK) with one or more Key Encryption Keys (KEKs). Each recipient is labeled, enabling multi-recipient access to the same encrypted content. Key rotation replaces the KEK wrapping without re-encrypting data blobs.

### Key Management

Multiple key sources are supported:

- **Raw keys**: 32-byte AES-256 key files read directly from disk.
- **Passphrase-derived keys (PBKDF2)**: PBKDF2-SHA512 with a default of 600,000 iterations. Policy-enforced minimum and maximum iteration bounds.
- **Passphrase-derived keys (scrypt)**: scrypt with default N=131072. Combined memory budget is capped at 1 GiB to prevent resource exhaustion.
- **OS keychain**: Passphrase sourced from the operating system's native keychain (macOS Keychain, Linux Secret Service, Windows Credential Manager) via `@git-stunts/vault`.

All KDF operations enforce a minimum 16-byte salt. Iteration counts and scrypt parameters are policy-bounded to prevent both weak derivation and denial-of-service.

### Compression

Content can be gzip-compressed before storage through the `CompressionPort` abstraction. The shipped `NodeCompressionAdapter` handles Node.js; other runtimes can plug in their own adapter. Compression composes cleanly with encryption — content is compressed, then encrypted. Plaintext + gzip restores now stream instead of buffering.

### Manifests

Two manifest versions handle assets of any size:

- **Version 1**: A flat manifest blob listing all chunk digests. Suitable for most assets.
- **Version 2**: A Merkle-style manifest that splits the chunk list into sub-manifests, each independently addressable and schema-validated. Automatically engaged when chunk count exceeds 1,000. Sub-manifest arrays are capped at 10,000 entries.

Every manifest carries an **integrity hash** — the SHA-256 of the codec-encoded content — verified on every read to detect corruption or tampering. Two codecs are available: **JSON** (human-readable, default) and **CBOR** (binary, compact).

Manifest diffing is available via `diffManifests()` for comparing two manifests and identifying changed, added, or removed chunks.

### Vault

The vault is a GC-safe named asset index stored at `refs/cas/vault`. It is the control plane for managing stored content.

- **CRUD**: Add, remove, list, and resolve named entries.
- **Encryption**: Vault entries can be encrypted with a passphrase.
- **Privacy mode**: HMAC-hashed slug names prevent metadata discovery — an observer cannot determine what assets are stored without the passphrase.
- **Encryption count tracking**: The vault tracks how many times each entry has been encrypted under the current nonce context, issuing rotation warnings as limits approach.
- **Passphrase rotation**: Rotate the vault passphrase across all entries in a single operation without re-encrypting data blobs.
- **Optimistic concurrency**: Vault writes use compare-and-swap semantics with automatic retry on conflict, ensuring safe concurrent access.

### Restore Modes

Three restore surfaces cover different memory and latency profiles:

| Method | Behavior | Bounded? |
|---|---|---|
| `restore()` | Buffered reassembly to memory | Yes — capped by `maxRestoreBufferSize` |
| `restoreFile()` | Atomic temp-file write with auth-then-rename | Yes — streams through disk |
| `restoreStream()` | Async iterable yielding chunks | Yes — frame-by-frame for framed scheme |

`restoreFile()` writes tentative plaintext to a temporary file, verifies authentication, and renames into place only after verification succeeds. For `framed`, all three surfaces provide true streaming restore with per-frame authentication. Parallel chunk restore is supported via a prefetch window (`PrefetchWindow`) when concurrency is greater than 1, enabling ordered parallel reads for faster restores.

### CLI

The `git-cas` command-line interface exposes the full feature set:

| Command | Purpose |
|---|---|
| `git-cas store` | Store a file or stream into the CAS |
| `git-cas restore` | Restore content by slug or manifest |
| `git-cas vault init` | Initialize a new vault |
| `git-cas vault add` | Add an entry to the vault |
| `git-cas vault list` | List vault entries |
| `git-cas vault remove` | Remove a vault entry |
| `git-cas vault dashboard` | Interactive TUI for vault navigation |
| `git-cas doctor` | Diagnose vault health and integrity |
| `git-cas rotate-passphrase` | Rotate the vault passphrase |

**Agent CLI**: `git-cas agent` exposes a JSONL-based protocol for CI/CD automation and programmatic integrations. Commands are sent as JSON objects on stdin; responses stream back as newline-delimited JSON on stdout.

### Security Hardening

Beyond the core encryption primitives, `git-cas` enforces a set of defensive limits:

- **Hex validation**: All OID and digest fields are schema-validated as strict hexadecimal strings.
- **scrypt memory cap**: Combined scrypt memory budget is hard-capped at 1 GiB.
- **Sub-manifest array limit**: Merkle sub-manifests are capped at 10,000 entries.
- **Concurrency cap**: Parallel operations are bounded at 64.
- **Frame size cap**: `frameBytes` is capped at 64 MiB.
- **Timing oracle elimination**: Recipient trial decryption uses constant-time comparison to prevent timing-based key identification.
- **Source validation**: Async iterables passed to `store()` are validated before processing begins.
- **Salt enforcement**: KDF salts must be at least 16 bytes.
- **Nonce rotation**: Encryption count tracking warns before nonce reuse becomes a concern.
- **Legacy scheme rejection**: Attempting to use a legacy encryption scheme (`whole-v1`, `whole-v2`, `framed-v1`, `framed-v2`, `convergent-v1`) throws a `LEGACY_SCHEME` error with migration guidance (see [UPGRADING.md](./UPGRADING.md)).

## Streaming Surface

| Surface | Streaming API? | Non-streaming API? | Notes |
|---|---|---|---|
| Write | `store({ source, ... })`, `storeFile(...)` | No dedicated non-streaming store facade | Write ingress is stream-based. CDC + encryption defaults to `convergent` (per-chunk deterministic encryption preserving dedup). Fixed + encryption defaults to `framed`. |
| Read: plaintext | `restoreStream(...)`, `restoreFile(...)` | `restore(...)` | True chunk-by-chunk streaming restore. |
| Read: encrypted `whole` | `restoreStream(...)`, `restoreFile(...)` | `restore(...)` | `restoreStream()` is the buffered compatibility path. `restoreFile()` uses a bounded temp-file path: verifies chunks, streams tentative plaintext through whole-object AES-GCM decryption, and renames into place only after auth succeeds. AAD (slug) is always bound. On Web Crypto runtimes this decrypt step is still one-shot internally, bounded by `maxDecryptionBufferSize`. |
| Read: encrypted `framed` | `restoreStream(...)`, `restoreFile(...)` | `restore(...)` | True authenticated streaming restore. Plaintext is yielded frame-by-frame after each frame is verified. Per-frame AAD is always bound. |
| Read: compressed-only | `restoreStream(...)`, `restoreFile(...)` | `restore(...)` | Plaintext + gzip now streams end-to-end. `restoreFile()` streams gunzip output through a bounded temp-file path. |
| Read: compressed + `whole` | `restoreStream(...)`, `restoreFile(...)` | `restore(...)` | `restoreStream()` is buffered because auth completes at the end of whole-object AES-GCM. `restoreFile()` decrypts and gunzips through the bounded temp-file path. |
| Read: compressed + `framed` | `restoreStream(...)`, `restoreFile(...)` | `restore(...)` | Streaming decrypt, then streaming gunzip. |
| Read: encrypted `convergent` | `restoreStream(...)`, `restoreFile(...)` | `restore(...)` | True per-chunk streaming restore. Each chunk is decrypted individually using a key derived from its content hash. Parallel chunk restore via prefetch window when concurrency > 1. |
| Read: compressed + `convergent` | `restoreStream(...)`, `restoreFile(...)` | `restore(...)` | Per-chunk convergent decrypt, then streaming gunzip. |
| Verify | No streaming verify surface | `verifyIntegrity(manifest, options?)` | Verifies chunk digests for all content. `whole` auth-checks the full ciphertext; `framed` parses and auth-checks every frame; `convergent` decrypts each chunk and verifies plaintext digests. |

Runtime note: `framed` is the honest cross-runtime streaming answer. On Node and Bun, `whole restoreFile()` has the stronger low-memory path; on Web Crypto runtimes such as Deno, `whole` remains bounded-buffer rather than true streaming.

## Architecture

`git-cas` follows a strict hexagonal (ports and adapters) architecture. The domain core has zero knowledge of runtime-specific APIs.

```
                          ┌─────────────────────┐
                          │  ContentAddressable  │
                          │    Store (Facade)    │
                          └──────────┬──────────┘
                                     │
                          ┌──────────▼──────────┐
                          │     CasService       │
                          │   (Domain Core)      │
                          └──┬──┬──┬──┬──┬──┬───┘
                             │  │  │  │  │  │
              ┌──────────────┘  │  │  │  │  └──────────────┐
              │        ┌────────┘  │  │  └────────┐        │
              ▼        ▼           ▼  ▼           ▼        ▼
         ┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐
         │Persist.││ Crypto ││ Codec  ││Compress││Chunking││Observe.│
         │  Port  ││  Port  ││  Port  ││  Port  ││  Port  ││  Port  │
         └───┬────┘└───┬────┘└───┬────┘└───┬────┘└───┬────┘└───┬────┘
             │         │         │         │         │         │
             ▼         ▼         ▼         ▼         ▼         ▼
          GitODB   Node/Bun   JSON or   Node gzip  Fixed or  Event
                   /Deno      CBOR      adapter    CDC/      Emitter
                   Crypto                Buzhash
```

**Ports** define the contracts. **Adapters** implement them for specific runtimes. Swap any adapter without touching domain logic.

The core byte contract is `Uint8Array`. Node `Buffer` values still work at the
Node boundary because `Buffer` extends `Uint8Array`, but the domain, ports,
chunkers, codecs, and shared helpers do not depend on Node-specific byte APIs.

## Multi-Runtime Support

| Runtime | Version | Crypto Backend | Status |
|---|---|---|---|
| **Node.js** | 22+ | `node:crypto` | Primary — full streaming support |
| **Bun** | Latest | `node:crypto` compat | Tested via Docker |
| **Deno** | Latest | Web Crypto API | Tested via Docker; `whole` decrypt is bounded-buffer |

All three runtimes are tested in CI on every push. The hexagonal architecture isolates runtime differences behind the `CryptoPort` boundary, so the domain core is runtime-agnostic.

## Documentation

- **[Guide](./GUIDE.md)**: Orientation, long-form walkthrough, and vault management.
- **[Advanced Guide](./ADVANCED_GUIDE.md)**: CDC tuning, large-asset Merkle trees, and performance baselines.
- **[Architecture](./ARCHITECTURE.md)**: The authoritative system map — Facade, Domain, Ports, and Adapters.
- **[Security](./SECURITY.md)**: Threat models, trust boundaries, and encryption internals.
- **[Agents](./AGENTS.md)**: JSONL agent protocol for CI/CD automation.
- **[Workflow](./WORKFLOW.md)**: Repo work doctrine, cycles, and invariants.
- **[Upgrading](./UPGRADING.md)**: Migration guide for v5 → v6.
- **[Changelog](./CHANGELOG.md)**: Version history and migration notes.

---
Built with terminal ambition by [FLYING ROBOTS](https://github.com/flyingrobots)
