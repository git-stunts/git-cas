# Design: Extract Platform Dependencies into Ports

## Problem

`CasService.js` imports `node:zlib`, `node:stream`, and `node:util`, coupling
domain logic to Node.js. This violates hexagonal architecture and prevents use
in browser/edge environments.

## Solution

Extract two new ports with Node-specific adapters.

### CompressionPort

```js
class CompressionPort {
  async compressBuffer(buffer) {}      // Buffer → Buffer
  async decompressBuffer(buffer) {}    // Buffer → Buffer
  compressStream(source) {}            // AsyncIterable<Buffer> → AsyncIterable<Buffer>
  decompressStream(source) {}          // AsyncIterable<Buffer> → AsyncIterable<Buffer>
}
```

**NodeCompressionAdapter**: Uses `node:zlib` (gzip/gunzip).

### StreamPort removal — NOT needed

Looking at actual usage, `Readable.from()` is only used to bridge async iterables
into `.pipe()` for gzip/gunzip streams. If the CompressionPort accepts async
iterables directly (instead of Node streams), the `node:stream` import disappears
entirely. No separate StreamPort needed.

### Changes

| Component | Change |
|-----------|--------|
| **CompressionPort** | New abstract port in `src/ports/` |
| **NodeCompressionAdapter** | New adapter in `src/infrastructure/adapters/` |
| **CasService constructor** | Accept `compression` port (like crypto, persistence) |
| **CasService._compressStream** | Delegate to `this.compressionPort.compressStream()` |
| **CasService._decompressBufferedWithLimit** | Delegate to `this.compressionPort.decompressBuffer()` |
| **CasService._decompressFramedStream** | Delegate to `this.compressionPort.decompressStream()` |
| **CasService imports** | Remove `node:zlib`, `node:stream`, `node:util` |
| **Facade (index.js)** | Wire NodeCompressionAdapter in ContentAddressableStore |

### Backward Compatibility

- External API unchanged — compression is still configured via `{ algorithm: 'gzip' }`
- Internal wiring change only — callers pass a CompressionPort instance
- Default to NodeCompressionAdapter if not provided (for backward compat)
