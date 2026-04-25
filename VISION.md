# VISION

`git-cas` is an industrial-grade Content-Addressable Storage engine where data integrity and Git-native reachability are unified.

```mermaid
mindmap
    root((git-cas))
        Content-Addressable
            SHA-256 Manifests
            Chunk-level Dedupe
            CDC & Fixed Chunks
            FastCDC Dual-Mask Normalization
            Manifest Integrity Hash
            Manifest Diffing
            formatVersion Capability Tracking
        Git-Native
            Object Database Substrate
            GC-Safe Vault Refs
            Tree Reachability
            Merkle Manifests
        Cryptographic Trust
            AES-256-GCM
            AAD Binding
                whole
                framed
                convergent
            Envelope Encryption
            Key Rotation
            KDF Policy Enforcement
            Convergent Encryption
        Privacy
            Vault Privacy Mode
            HMAC Slug Masking
            Encrypted Privacy Index
        Multi-Runtime
            Node.js
            Bun
            Deno
            Platform-Agnostic Domain
        Hexagonal Architecture
            CryptoPort
            PersistencePort
            ChunkingPort
            CodecPort
            CompressionPort
            ObservabilityPort
        Performance
            PrefetchWindow Parallel Restore
            Incremental Sync via Manifest Diff
        Agent-Human Parity
            JSONL Agent CLI
            Human TUI Cockpit
            Versioned Schemas
```

## Core Tenets

### 1. The Substrate is Sufficient
Git is not just for source code. Its object database is a world-class, replicated, and secure blob store. `git-cas` uses this substrate without inventing new storage formats or protocols.

### 2. Integrity is Non-Negotiable
Every byte stored is verified against a SHA-256 manifest. Corruption is detected at the chunk level, and re-assembly is a deterministic process governed by immutable receipts.

### 3. Privacy by Design
Encryption is a first-class citizen, not an addon. Three encryption schemes — whole, framed, and convergent — cover every use case from single-blob encryption to dedup-safe multi-chunk storage. Envelope encryption allows for flexible multi-party access control and rotation without re-encrypting the underlying data bedrock. Convergent encryption resolves the fundamental tension between encryption and deduplication: identical plaintext always produces identical ciphertext, enabling chunk-level dedup even across encrypted stores. Vault privacy mode and HMAC slug masking ensure that even metadata leaks nothing.

### 4. Machine-First, Human-Enhanced
The system is built for automation. Agentic CLI surfaces and JSONL protocols ensure that `git-cas` can be a reliable part of a high-fidelity CI/CD or agentic workflow.

### 5. Defense in Depth
No single mechanism is trusted to stand alone. Chunk integrity guards the data. Manifest hashes guard the structure. AAD binding guards the cryptographic context. KDF policy enforcement guards the key material. Schema validation guards the protocol boundary. Timing oracle elimination guards the side channels. Every layer assumes the others have already failed.

---
**The goal is inevitably. Git, freebased: pure CAS that stays in your repository.**
