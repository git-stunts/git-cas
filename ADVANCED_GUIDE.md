# Advanced Guide — git-cas

This is the second-track manual for `git-cas`. Use it when you need the deeper doctrine behind chunking strategies, large-asset Merkle trees, and performance baselines.

For orientation and the productive-fast path, use the [GUIDE.md](./GUIDE.md).

## Content-Defined Chunking (CDC)

`git-cas` uses the Buzhash algorithm for content-defined chunking. Unlike fixed-size chunking, CDC is resilient to insertions and deletions, allowing for better deduplication across slightly modified versions of the same file.

- **Deduplication Advantage**: High for unencrypted text and structured data.
- **Encryption Penalty**: CDC deduplication is ineffective when encryption is enabled because ciphertext is pseudorandom and lacks structural patterns.
- **Tuning**: Adjust `targetChunkSize`, `minChunkSize`, and `maxChunkSize` based on your data distribution.

## Merkle-Style Manifests

For giant assets, `git-cas` automatically transitions to a Merkle-style manifest structure when the chunk count exceeds `merkleThreshold` (default: 1000).

1. **Root Manifest**: Contains `version: 2` and a list of `subManifests` (Git blob OIDs).
2. **Sub-Manifests**: Partitioned lists of chunks.
3. **Transparency**: The library facade and CLI tools resolve these hierarchies automatically.

## Performance Baselines

The following baselines are published for the current release line (`v5.3.x`).

| Strategy | Asset Size | Total Chunks | Store (ms) | Restore (ms) | Dedupe (%) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Fixed (256K)** | 100 MiB | 400 | ~450 | ~300 | 0% |
| **CDC (256K avg)** | 100 MiB | ~390 | ~1200 | ~350 | 98%+ |

*Note: CDC store time includes Buzhash rolling hash overhead. Restore time is comparable to fixed-size chunking.*

## Security & Threat Model

Deep technical doctrine on encryption envelopes and trust boundaries lives in [SECURITY.md](./SECURITY.md) and [docs/THREAT_MODEL.md](./docs/THREAT_MODEL.md).

---
**The goal is inevitably. Every feature is defined by its tests.**
