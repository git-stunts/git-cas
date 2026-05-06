# Extending `git-cas`

This guide describes supported extension points for applications that need
custom persistence, codecs, chunking, compression, crypto, or observability.

Most users should start with the facade:

```js
import GitPlumbing from '@git-stunts/plumbing';
import ContentAddressableStore from '@git-stunts/git-cas';

const plumbing = await GitPlumbing.createDefault({ cwd: '.' });
const cas = ContentAddressableStore.createJson({ plumbing });
```

Construct `CasService` directly only when you own the complete adapter boundary
or are writing focused tests.

## Extension Points

| Area | Preferred Entry | Contract |
| --- | --- | --- |
| Persistence | Custom `GitPersistencePort` implementation | Blob/tree read and write, plus streaming reads |
| Refs | Custom `GitRefPort` implementation | Ref resolution, commit creation, atomic updates |
| Codecs | `codec` option or direct `CasService` injection | `encode()`, `decode()`, and `extension` |
| Chunking | Facade chunking config or `ChunkingPort` injection | Async chunk iteration with stable strategy metadata |
| Compression | `compressionAdapter` injection | gzip-compatible buffer and stream methods |
| Crypto | `crypto` injection | SHA-256, AES-GCM, HMAC, KDF, and stream capability reporting |
| Observability | `observability` injection | `metric()`, `log()`, and `span()` |

See [ADVANCED_GUIDE.md](../ADVANCED_GUIDE.md#direct-casservice-and-custom-port-contracts)
for the full direct-construction contract and
[docs/API.md](./API.md#ports) for method-level API details.

## Direct Service Construction

Direct construction requires every domain dependency. The facade supplies these
defaults for normal Git-backed use; direct callers must supply them explicitly.

```js
import {
  FixedChunker,
  JsonCodec,
  NodeCompressionAdapter,
  NodeCryptoAdapter,
  SilentObserver,
} from '@git-stunts/git-cas';
import CasService from '@git-stunts/git-cas/service';

const service = new CasService({
  persistence,
  codec: new JsonCodec(),
  crypto: new NodeCryptoAdapter(),
  observability: new SilentObserver(),
  chunker: new FixedChunker({ chunkSize: 256 * 1024 }),
  compressionAdapter: new NodeCompressionAdapter(),
  formatVersion: '6.0.0',
});
```

The domain byte contract is `Uint8Array`. Node `Buffer` values work at Node
boundaries because `Buffer` extends `Uint8Array`, but portable adapters should
not require Buffer-only APIs.

## Persistence Adapter Requirements

Custom persistence adapters must preserve Git-like object semantics:

- `writeBlob(bytes)` stores immutable bytes and returns the blob OID
- `readBlob(oid)` returns the exact bytes written for that OID
- `writeTree(entries)` writes named tree entries and returns a tree OID
- `readTree(treeOid)` returns mode/type/OID/name entries
- `readBlobStream(oid)` returns an async iterable or readable stream of bytes

`readBlobStream()` is required for bounded restore paths. Encrypted or
compressed restores can otherwise require full ciphertext buffering and will
fail with `PERSISTENCE_CAPABILITY_REQUIRED` when the adapter cannot provide the
streaming read capability safely.

## Codec Requirements

A codec serializes and deserializes manifest objects:

```js
const encoder = new TextEncoder();
const decoder = new TextDecoder();

class MyCodec {
  get extension() {
    return 'myfmt';
  }

  encode(value) {
    return encoder.encode(JSON.stringify(value));
  }

  decode(bytes) {
    return JSON.parse(decoder.decode(bytes));
  }
}
```

Codec output is part of the manifest integrity hash. Keep encoding
deterministic across platforms and versions. If a codec changes its canonical
output, old manifests may fail integrity verification.

## Chunking Requirements

Chunkers expose `chunk(source)` and return ordered chunks with byte content and
metadata. Stable ordering is mandatory because manifests record chunk order.

Use `FixedChunker` for predictable block boundaries. Use `CdcChunker` for
deduplication workloads where insertions and deletions should not shift every
downstream chunk.

## Compression Adapter Requirements

Compression adapters provide both buffer and stream forms:

- `compressBuffer(bytes)`
- `decompressBuffer(bytes)`
- `compressStream(source)`
- `decompressStream(source)`

The manifest schema currently supports `gzip`. Custom adapters should preserve
the same algorithm name unless a future schema explicitly adds another
compression algorithm.

## Crypto Adapter Requirements

Crypto adapters implement hashing, random bytes, AES-256-GCM, HMAC, KDF, and
stream encryption/decryption where supported. Runtime limitations must surface
as explicit capability errors rather than silent fallback.

Notable requirements:

- AES-GCM nonces are 12 bytes.
- GCM tags are 16 bytes.
- PBKDF2 must derive 32-byte keys with policy-bounded parameters.
- scrypt support is runtime-dependent; Web Crypto runtimes should report a
  capability error instead of pretending to support it.

## Observability Adapter Requirements

Observability is intentionally narrow:

```js
const observer = {
  metric(name, value, tags) {},
  log(level, message, context) {},
  span(name, context) {
    return { end(status) {} };
  },
};
```

Use this for progress, warnings, and release-readiness telemetry. Do not put
business logic in observers; observers should be replaceable without changing
storage behavior.

## Compatibility Checklist

Before shipping a custom adapter:

- run the relevant unit tests against the adapter
- verify `storeFile()` and `restoreFile()` round trips with binary data
- verify encrypted `whole`, `framed`, and `convergent` restores
- verify gzip restore if compression is enabled
- verify large restores do not exceed configured buffer limits
- verify errors are `CasError` instances with actionable `code` values
- document runtime-specific limits and unsupported methods
