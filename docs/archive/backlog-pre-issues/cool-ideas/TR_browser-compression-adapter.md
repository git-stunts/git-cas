# TR — Browser CompressionPort Adapter

## The Idea

Now that `CompressionPort` is extracted from CasService, a browser/edge adapter
is straightforward. Modern browsers ship `CompressionStream` and
`DecompressionStream` (the Compression Streams API) which support gzip natively.

```js
class BrowserCompressionAdapter extends CompressionPort {
  async *compressStream(source) {
    const cs = new CompressionStream('gzip');
    // pipe async iterable through cs.writable/readable
  }
  async *decompressStream(source) {
    const ds = new DecompressionStream('gzip');
    // pipe async iterable through ds.writable/readable
  }
}
```

## Why It's Interesting

- Unblocks browser/edge usage of git-cas (along with WebCryptoAdapter)
- Zero dependencies — uses built-in browser APIs
- The port abstraction is already in place — just needs an adapter
- Could also work in Deno (which supports Compression Streams natively)
- Combined with the existing `WebCryptoAdapter`, this would make git-cas
  fully functional in browser environments (minus Git persistence, which
  would need its own browser adapter)

## Prerequisites

- CompressionPort extraction (done)
- Browser-compatible persistence adapter (not yet — would need IndexedDB
  or HTTP-based blob storage)
