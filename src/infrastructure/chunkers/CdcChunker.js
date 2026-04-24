/**
 * Content-Defined Chunking engine using Buzhash rolling hash.
 *
 * Splits an async stream of buffers into content-defined chunks whose
 * boundaries are determined by the rolling hash value.  This provides
 * shift-resistant deduplication — small edits only affect nearby chunks.
 *
 * @example
 * ```js
 * import CdcChunker from './CdcChunker.js';
 * const chunker = new CdcChunker({ targetChunkSize: 262144 });
 * for await (const chunk of chunker.chunk(source)) {
 *   console.log(chunk.length);
 * }
 * ```
 */

import ChunkingPort from '../../ports/ChunkingPort.js';

// ---------------------------------------------------------------------------
// Buzhash byte-table (256 entries, deterministic)
// ---------------------------------------------------------------------------
// Generated from a seeded xorshift64 PRNG so every runtime produces the
// same table without needing `crypto.getRandomValues`.
// ---------------------------------------------------------------------------

/**
 * Generates the deterministic 256-entry Buzhash byte table using a
 * seeded xorshift64 PRNG.
 * @returns {Uint32Array}
 */
function generateBuzTable() {
  const table = new Uint32Array(256);
  // Seed chosen arbitrarily — must never change.
  let s = BigInt('0x6a09e667f3bcc908');
  for (let i = 0; i < 256; i++) {
    // xorshift64
    s ^= s << 13n;
    s &= 0xffffffffffffffffn;
    s ^= s >> 7n;
    s &= 0xffffffffffffffffn;
    s ^= s << 17n;
    s &= 0xffffffffffffffffn;
    table[i] = Number(s & 0xffffffffn);
  }
  return table;
}

/** @type {Uint32Array} */
const BUZ_TABLE = generateBuzTable();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Window size for the Buzhash sliding window. */
const WINDOW_SIZE = 64;
const WINDOW_MASK = WINDOW_SIZE - 1; // 63, for fast modulo

// ---------------------------------------------------------------------------
// Rolling-hash state object
// ---------------------------------------------------------------------------

/**
 * Mutable rolling-hash + chunk-accumulation state.
 *
 * Passed by reference into the per-phase helper functions so that the
 * `chunk()` async generator stays short and simple.  Also carries the
 * chunker configuration to keep helper parameter counts low.
 *
 * @typedef {Object} ChunkState
 * @property {number} hash       - Current Buzhash value.
 * @property {Uint8Array} win    - Sliding window ring buffer.
 * @property {number} winPos     - Current write position in `win`.
 * @property {number} hashFed    - Bytes fed since last reset.
 * @property {Buffer} chunkBuf   - Pre-allocated chunk output buffer.
 * @property {number} chunkLen   - Bytes written to chunkBuf so far.
 * @property {number} minSize    - Minimum chunk size.
 * @property {number} maxSize    - Maximum chunk size.
 * @property {number} mask       - Boundary detection mask (single-mask mode).
 * @property {number} hardMask   - Stricter mask for below-target (normalized mode).
 * @property {number} easyMask   - Looser mask for above-target (normalized mode).
 * @property {number} targetSize - Target chunk size (normalized mode).
 * @property {boolean} normalized - Whether dual-mask normalization is active.
 */

/**
 * Reset rolling-hash and chunk accumulation state for a new chunk.
 * @param {ChunkState} st
 */
function resetState(st) {
  st.hash = 0;
  st.winPos = 0;
  st.hashFed = 0;
  st.chunkLen = 0;
  st.win.fill(0);
}

// ---------------------------------------------------------------------------
// Per-phase helpers (keep the async generator under the line/complexity cap)
// ---------------------------------------------------------------------------

/**
 * Phase 1 — fill the sliding window (first 64 bytes of each chunk).
 * Uses a simplified hash update (no outgoing-byte removal).
 *
 * @param {ChunkState} st
 * @param {Buffer} buf   - Source buffer being processed.
 * @param {number} srcPos - Current read offset in `buf`.
 * @returns {number} Updated srcPos.
 */
function fillWindow(st, buf, srcPos) {
  const need = WINDOW_SIZE - st.hashFed;
  const avail = buf.length - srcPos;
  const n = need < avail ? need : avail;
  const end = srcPos + n;
  const table = BUZ_TABLE;

  while (srcPos < end) {
    const byte = buf[srcPos];
    st.hash = (((st.hash << 1) | (st.hash >>> 31)) ^ table[byte]) >>> 0;
    st.win[st.winPos] = byte;
    st.winPos = (st.winPos + 1) & WINDOW_MASK;
    st.chunkBuf[st.chunkLen++] = byte;
    srcPos++;
  }
  st.hashFed += n;
  return srcPos;
}

/**
 * Phase 2 — pre-min region (window full, no boundary checks).
 * Bulk-copies bytes into the chunk buffer while updating the hash.
 *
 * @param {ChunkState} st
 * @param {Buffer} buf
 * @param {number} srcPos
 * @returns {number} Updated srcPos.
 */
function feedPreMin(st, buf, srcPos) {
  const needed = st.minSize - st.chunkLen;
  const avail = buf.length - srcPos;
  const n = needed < avail ? needed : avail;
  const end = srcPos + n;
  const table = BUZ_TABLE;

  // Bulk-copy into chunk buffer
  buf.copy(st.chunkBuf, st.chunkLen, srcPos, end);

  // Feed bytes into rolling hash (window is full)
  while (srcPos < end) {
    const byte = buf[srcPos];
    st.hash = (((st.hash << 1) | (st.hash >>> 31)) ^ table[st.win[st.winPos]] ^ table[byte]) >>> 0;
    st.win[st.winPos] = byte;
    st.winPos = (st.winPos + 1) & WINDOW_MASK;
    srcPos++;
  }
  st.chunkLen += n;
  return srcPos;
}

/**
 * Phase 3 — scan for a content-defined boundary in [minSize, maxSize).
 *
 * @param {ChunkState} st
 * @param {Buffer} buf
 * @param {number} srcPos
 * @returns {{ srcPos: number, found: boolean }}
 */
function scanBoundary(st, buf, srcPos) {
  const { maxSize, normalized, hardMask, easyMask, targetSize, mask } = st;
  const table = BUZ_TABLE;
  const limit = buf.length < (srcPos + maxSize - st.chunkLen)
    ? buf.length
    : (srcPos + maxSize - st.chunkLen);

  let h = st.hash;
  let wp = st.winPos;
  const { win, chunkBuf } = st;
  let cl = st.chunkLen;

  while (srcPos < limit) {
    const byte = buf[srcPos];
    h = (((h << 1) | (h >>> 31)) ^ table[win[wp]] ^ table[byte]) >>> 0;
    win[wp] = byte;
    wp = (wp + 1) & WINDOW_MASK;
    chunkBuf[cl++] = byte;
    srcPos++;

    const m = normalized ? (cl < targetSize ? hardMask : easyMask) : mask;
    if ((h & m) === 0) {
      st.hash = h;
      st.winPos = wp;
      st.chunkLen = cl;
      return { srcPos, found: true };
    }
  }

  st.hash = h;
  st.winPos = wp;
  st.chunkLen = cl;
  return { srcPos, found: false };
}

/**
 * Process a single source buffer through all three CDC phases.
 *
 * Returns an array of completed chunks (may be empty if no boundary
 * was found within this buffer).
 *
 * @param {ChunkState} st
 * @param {Buffer} buf
 * @returns {Buffer[]} Completed chunks ready to yield.
 */
function processBuf(st, buf) {
  /** @type {Buffer[]} */
  const completed = [];
  let srcPos = 0;

  while (srcPos < buf.length) {
    // Phase 1: fill window if needed
    if (st.hashFed < WINDOW_SIZE) {
      srcPos = fillWindow(st, buf, srcPos);
      if (st.hashFed < WINDOW_SIZE) { break; }
    }

    // Phase 2: bulk-feed bytes until minSize
    if (st.chunkLen < st.minSize) {
      srcPos = feedPreMin(st, buf, srcPos);
    }

    // Phase 3: scan for boundary
    const result = scanBoundary(st, buf, srcPos);
    srcPos = result.srcPos;

    if (result.found || st.chunkLen >= st.maxSize) {
      completed.push(Buffer.from(st.chunkBuf.subarray(0, st.chunkLen)));
      resetState(st);
    }
  }

  return completed;
}

// ---------------------------------------------------------------------------
// CdcChunker
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CdcChunkerOptions
 * @property {number} [minChunkSize=65536]   - Minimum chunk size in bytes (64 KiB).
 * @property {number} [maxChunkSize=1048576] - Maximum chunk size in bytes (1 MiB).
 * @property {number} [targetChunkSize=262144] - Target (average) chunk size in bytes (256 KiB).
 * @property {boolean} [normalized=true] - Enable FastCDC dual-mask normalization.
 */

/**
 * CDC chunker that uses a Buzhash rolling hash to find content-defined
 * chunk boundaries within an async byte stream.
 *
 * When `normalized` is true (the default), a dual-mask strategy is used:
 * a stricter mask below the target size and a looser mask above it. This
 * concentrates the chunk size distribution around the target, improving
 * deduplication efficiency.
 */
export default class CdcChunker extends ChunkingPort {
  /** @type {number} */ #minChunkSize;
  /** @type {number} */ #maxChunkSize;
  /** @type {number} */ #targetChunkSize;
  /** @type {number} */ #mask;
  /** @type {number} */ #hardMask;
  /** @type {number} */ #easyMask;
  /** @type {boolean} */ #normalized;

  /**
   * @param {CdcChunkerOptions} [options]
   */
  constructor({
    minChunkSize = 65_536,
    maxChunkSize = 1_048_576,
    targetChunkSize = 262_144,
    normalized = true,
  } = {}) {
    super();
    if (minChunkSize > maxChunkSize) {
      throw new RangeError(
        `minChunkSize (${minChunkSize}) must not exceed maxChunkSize (${maxChunkSize})`,
      );
    }
    if (targetChunkSize < minChunkSize || targetChunkSize > maxChunkSize) {
      throw new RangeError(
        `targetChunkSize (${targetChunkSize}) must be in [${minChunkSize}, ${maxChunkSize}]`,
      );
    }
    if (maxChunkSize > 100 * 1024 * 1024) {
      throw new RangeError(
        `maxChunkSize must not exceed 104857600 bytes (100 MiB), got ${maxChunkSize}`,
      );
    }

    this.#minChunkSize = minChunkSize;
    this.#maxChunkSize = maxChunkSize;
    this.#targetChunkSize = targetChunkSize;
    this.#normalized = normalized;

    // Mask: nearest power-of-2 minus 1 that is <= targetChunkSize.
    // E.g. target 262144 (2^18) -> mask 0x3FFFF (2^18 - 1).
    const bits = Math.floor(Math.log2(targetChunkSize));
    this.#mask = ((1 << bits) - 1) >>> 0;

    // Dual-mask for normalized mode (FastCDC):
    // hardMask: more bits → less likely to match (below target)
    // easyMask: fewer bits → more likely to match (above target)
    this.#hardMask = ((1 << Math.min(bits + 1, 31)) - 1) >>> 0;
    this.#easyMask = ((1 << Math.max(bits - 1, 1)) - 1) >>> 0;
  }

  /** @override */
  get strategy() {
    return 'cdc';
  }

  /** @override */
  get params() {
    return {
      target: this.#targetChunkSize,
      min: this.#minChunkSize,
      max: this.#maxChunkSize,
      normalized: this.#normalized,
    };
  }

  /**
   * Splits an async byte stream into content-defined chunks.
   *
   * Yields `Buffer` instances.  The caller may concatenate them or write
   * each one directly to storage.
   *
   * @override
   * @param {AsyncIterable<Buffer>} source - Incoming byte stream.
   * @yields {Buffer} Content-defined chunks.
   */
  async *chunk(source) {
    /** @type {ChunkState} */
    const st = {
      hash: 0,
      win: new Uint8Array(WINDOW_SIZE),
      winPos: 0,
      hashFed: 0,
      chunkBuf: Buffer.allocUnsafe(this.#maxChunkSize),
      chunkLen: 0,
      minSize: this.#minChunkSize,
      maxSize: this.#maxChunkSize,
      mask: this.#mask,
      hardMask: this.#hardMask,
      easyMask: this.#easyMask,
      targetSize: this.#targetChunkSize,
      normalized: this.#normalized,
    };

    for await (const buf of source) {
      const chunks = processBuf(st, buf);
      for (const c of chunks) { yield c; }
    }

    // Flush final partial chunk (may be < minSize — allowed for EOF).
    if (st.chunkLen > 0) {
      yield Buffer.from(st.chunkBuf.subarray(0, st.chunkLen));
    }
  }
}
