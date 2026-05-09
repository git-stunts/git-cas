import {
  SCHEME_CONVERGENT,
  SCHEME_FRAMED,
  SCHEME_WHOLE,
} from '../encryption/schemes.js';

/** @typedef {import('../value-objects/Manifest.js').default} Manifest */

/**
 * @typedef {'convergent'|'convergent-compressed'|'framed-compressed'|'framed'|'buffered'|'compressed-streaming'|'streaming'} RestoreStrategy
 */

const STRATEGY_HANDLER = Object.freeze({
  convergent: 'restoreConvergentStreaming',
  'convergent-compressed': 'restoreConvergentCompressed',
  'framed-compressed': 'restoreFramedCompressedStreaming',
  framed: 'restoreFramedStreaming',
  buffered: 'restoreBuffered',
  'compressed-streaming': 'restoreCompressedStreaming',
  streaming: 'restoreStreaming',
});

/**
 * @param {string|undefined} scheme
 * @param {{ compression?: unknown }} manifest
 * @returns {RestoreStrategy}
 */
export function classifyRestoreStrategy(scheme, manifest) {
  if (scheme === SCHEME_CONVERGENT) {
    return manifest.compression ? 'convergent-compressed' : 'convergent';
  }
  if (scheme === SCHEME_FRAMED) {
    return manifest.compression ? 'framed-compressed' : 'framed';
  }
  if (scheme === SCHEME_WHOLE) {
    return 'buffered';
  }
  if (manifest.compression) {
    return 'compressed-streaming';
  }
  return 'streaming';
}

/**
 * Owns restore-strategy selection and dispatch. The byte-level restore
 * handlers stay injected so CasService can preserve its public API while the
 * orchestration boundary becomes independently testable.
 */
export default class RestorePipeline {
  #handlers;

  /**
   * @param {Record<string, (ctx: { manifest: Manifest, key?: Uint8Array, encryptionMeta?: object }) => AsyncIterable<Uint8Array>>} handlers
   */
  constructor(handlers) {
    this.#handlers = handlers;
  }

  /**
   * @param {{ manifest: Manifest, key?: Uint8Array, encryptionMeta?: object }} ctx
   * @returns {AsyncIterable<Uint8Array>}
   */
  async *restore(ctx) {
    const strategy = classifyRestoreStrategy(ctx.encryptionMeta?.scheme, ctx.manifest);
    const handlerName = STRATEGY_HANDLER[strategy];
    yield* this.#handlers[handlerName](ctx);
  }
}
