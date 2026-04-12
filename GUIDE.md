# Guide — git-cas

This is the developer-level operator guide for `git-cas`. Use it for orientation, the productive-fast path, and to understand how the Content-Addressable Storage engine orchestrates Git blobs.

For deep-track doctrine, benchmarking, and large-asset Merkle trees, use [docs/BENCHMARKS.md](./docs/BENCHMARKS.md).

## Choose Your Lane

### 1. Build a Storage Integration
Integrate managed blob storage into your TypeScript or JavaScript application.
- **Read**: [Library Quick Start](./README.md#library-quick-start)
- **Host**: [Architecture](./ARCHITECTURE.md) (Port/Adapter model)

### 2. Manual CLI/TUI Usage
Store, restore, and verify assets from your terminal.
- **Read**: [CLI Quick Start](./README.md#cli-quick-start)
- **TUI**: `git-cas vault dashboard`

### 3. Agentic Automation
Use the machine-facing agent CLI for structured CI/CD or agentic workflows.
- **Read**: [API Signpost](./docs/API.md)
- **Run**: `git-cas agent <command>`

### 4. Advanced Walkthrough
Learn the long-form mechanics of vault management and multi-recipient encryption.
- **Read**: [Walkthrough](./docs/WALKTHROUGH.md)

## Big Picture: System Orchestration

`git-cas` is a tiered engine. You choose your depth based on the task:

1. **Facade (Facade)**: The public entry point (`index.js`). It manages lazy initialization and adaptive crypto selection.
2. **CasService (Engine)**: The primary domain service. It orchestrates chunking, encryption, and manifest creation.
3. **VaultService (Index)**: Manages named asset reachability through a GC-safe ref-based index.
4. **Ports (Bedrock)**: Pure interfaces for Git, Crypto, and Chunks. They isolate the domain from physical I/O.

## Orientation Checklist

- [ ] **I am storing local build artifacts**: Use `git-cas store` with `--tree`.
- [ ] **I need to encrypt sensitive data**: Use `--vault-passphrase` or `--recipient`.
- [ ] **I am debugging blob reachability**: Run `git-cas doctor`.
- [ ] **I am contributing to git-cas**: Read `METHOD.md` and `BEARING.md`.

## Rule of Thumb

If you need a comprehensive command reference, use [docs/API.md](./docs/API.md).

If you need to know "what's true right now," use [STATUS.md](./STATUS.md).

If you are just starting, use the [README.md](./README.md) and the orientation tracks above.

---
**The goal is inevitably. Every feature is defined by its tests.**
