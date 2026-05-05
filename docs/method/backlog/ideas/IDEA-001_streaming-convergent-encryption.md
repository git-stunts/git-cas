# IDEA: Streaming Convergent Encryption

**ID:** `IDEA-001`
**Status:** `Backlog`
**Priority:** `Low`
**Category:** `Optimization`

## Context

Convergent encryption currently requires buffering a full chunk in memory to compute its SHA-256 hash before deriving the deterministic key and nonce for AES-GCM encryption. While this is necessary for content-defined boundaries, it limits the throughput for large fixed-size chunks.

## The Idea

Implement a "True Streaming" convergent path for fixed-size chunking:
1.  **Concurrent Hashing/Buffering:** As bytes flow into the chunker, feed them into both a hash accumulator and a temporary buffer (or the AES-GCM input stream).
2.  **Pipeline Overlap:** Once the chunk boundary is hit (or the full buffer is available), the hash is already computed.
3.  **Single-Pass (Theoretical):** Investigate if certain AES-GCM implementations or custom HMAC-based convergent schemes allow for a more integrated single-pass approach on supported runtimes.

## Potential Benefits

- **Memory Efficiency:** Reduced peak memory usage during large-chunk encryption.
- **Throughput:** Improved performance for encrypted stores on high-latency or slow-I/O systems.
- **CPU Parallelism:** Hashing can happen in parallel with the data stream.

## Complexity

- **AES-GCM Nonce/Key Requirement:** AES-GCM *requires* the key and nonce before encryption begins. Convergent encryption *requires* the hash to derive the key/nonce. This creates a hard sequential dependency unless the encryption is deferred until the hash is ready.
- **Worthiness:** Fixed-size chunking is less common for deduplication-heavy workloads where CDC is preferred.
