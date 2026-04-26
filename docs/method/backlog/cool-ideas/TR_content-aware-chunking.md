# TR — Content-Aware Chunking Strategy Selection

## The Idea

Auto-detect file type and select the optimal chunking strategy. Different
content types have very different dedup characteristics:

| Content Type | Best Strategy | Why |
|---|---|---|
| Text, source code, JSON | CDC | High dedup from structural patterns |
| Uncompressed binary (raw images, PCM audio) | CDC | Byte-level patterns survive edits |
| Already-compressed (zip, mp4, jpg, gzip) | Fixed | CDC wastes CPU — compressed bytes are pseudorandom, no structural patterns to exploit |
| Encrypted content | Fixed | Same as compressed — pseudorandom bytes |

## Why It's Interesting

- **Automatic optimization**: Users don't need to know about chunking to get
  good performance. `store()` just does the right thing.
- **CPU savings**: CDC's Buzhash rolling hash is ~3x slower than fixed chunking.
  For already-compressed files where CDC provides zero dedup benefit, this is
  pure waste.
- **The ChunkingPort abstraction supports it**: `resolveChunker` already
  selects strategies. A content-aware wrapper could inspect the first few bytes
  (magic numbers) and choose.

## Design Sketch

```js
class ContentAwareChunker extends ChunkingPort {
  constructor({ cdcChunker, fixedChunker }) { ... }

  async *chunk(source) {
    // Peek at first chunk to detect content type
    const firstBytes = await peekBytes(source, 512);
    const isCompressed = detectCompressed(firstBytes); // zip, gzip, mp4, jpg magic
    const strategy = isCompressed ? this.fixedChunker : this.cdcChunker;
    yield* strategy.chunk(replaySource(firstBytes, source));
  }

  get strategy() { return 'content-aware'; }
}
```

## Tradeoffs

- **Peek overhead**: Need to buffer first bytes to detect type, then replay them
  into the chosen chunker. Minor complexity.
- **Mixed content**: A tar archive containing both text and compressed files
  would be chunked with one strategy for the whole stream. Per-entry detection
  would require tar-awareness, which is out of scope.
