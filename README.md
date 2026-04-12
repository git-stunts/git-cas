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

## Documentation

- **[Guide](./docs/GUIDE.md)**: Orientation, long-form walkthrough, and vault management.
- **[Advanced Guide](./docs/BENCHMARKS.md)**: Performance baselines, CDC tuning, and large-asset Merkle trees.
- **[Architecture](./ARCHITECTURE.md)**: The authoritative system map (Facade, Domain, Ports).
- **[Security](./SECURITY.md)**: Threat models, trust boundaries, and encryption internals.
- **[Workflow](./WORKFLOW.md)**: Repo work doctrine, cycles, and invariants.

---
Built with terminal ambition by [FLYING ROBOTS](https://github.com/flyingrobots)
