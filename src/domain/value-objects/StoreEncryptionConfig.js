import createCasError from '../errors/createCasError.js';
import {
  SCHEME_CONVERGENT,
  SCHEME_FRAMED,
  SCHEME_WHOLE,
} from '../encryption/schemes.js';
import { ErrorCodes } from '../errors/index.js';

export const DEFAULT_FRAMED_FRAME_BYTES = 64 * 1024;
export const MAX_FRAMED_FRAME_BYTES = 64 * 1024 * 1024;

/**
 * Immutable store-time encryption strategy configuration.
 */
export default class StoreEncryptionConfig {
  /**
   * @param {{ scheme: 'whole'|'framed'|'convergent', frameBytes?: number }} fields
   */
  constructor(fields) {
    this.scheme = fields.scheme;
    if (fields.frameBytes !== undefined) {
      this.frameBytes = fields.frameBytes;
    }
    Object.freeze(this);
  }

  /**
   * @param {{ encryption?: { scheme?: string, frameBytes?: number, convergent?: boolean }, hasEncryptionKey: boolean, chunker: { strategy?: string }, observability: { log: Function } }} options
   * @returns {StoreEncryptionConfig|undefined}
   */
  static resolve({ encryption, hasEncryptionKey, chunker, observability }) {
    const scheme = encryption?.scheme;
    const frameBytes = encryption?.frameBytes;
    StoreEncryptionConfig.#assertPrereqs({ hasEncryptionKey, scheme, frameBytes });

    if (!hasEncryptionKey) {
      return undefined;
    }
    if (scheme === SCHEME_CONVERGENT) {
      return new StoreEncryptionConfig({ scheme: SCHEME_CONVERGENT });
    }
    if (scheme === SCHEME_WHOLE) {
      return new StoreEncryptionConfig({ scheme: SCHEME_WHOLE });
    }
    if (scheme === SCHEME_FRAMED) {
      return StoreEncryptionConfig.resolveFramed(frameBytes);
    }
    if (!scheme) {
      return StoreEncryptionConfig.#resolveAuto({ encryption, frameBytes, chunker, observability });
    }

    throw createCasError(`Unsupported encryption scheme: ${scheme}`, ErrorCodes.INVALID_OPTIONS, { scheme });
  }

  /**
   * @param {number|undefined} frameBytes
   * @returns {StoreEncryptionConfig}
   */
  static resolveFramed(frameBytes) {
    const normalizedFrameBytes = frameBytes ?? DEFAULT_FRAMED_FRAME_BYTES;
    if (!Number.isInteger(normalizedFrameBytes) || normalizedFrameBytes < 1) {
      throw createCasError(
        'encryption.frameBytes must be a positive integer',
        ErrorCodes.INVALID_OPTIONS,
        { frameBytes: normalizedFrameBytes },
      );
    }
    if (normalizedFrameBytes > MAX_FRAMED_FRAME_BYTES) {
      throw createCasError(
        `encryption.frameBytes must not exceed ${MAX_FRAMED_FRAME_BYTES} bytes (64 MiB), got ${normalizedFrameBytes}`,
        ErrorCodes.INVALID_OPTIONS,
        { frameBytes: normalizedFrameBytes, max: MAX_FRAMED_FRAME_BYTES },
      );
    }
    return new StoreEncryptionConfig({ scheme: SCHEME_FRAMED, frameBytes: normalizedFrameBytes });
  }

  static #resolveAuto({ encryption, frameBytes, chunker, observability }) {
    const convergentExplicit = encryption?.convergent;
    if (convergentExplicit === true || (convergentExplicit !== false && chunker.strategy === 'cdc')) {
      if (convergentExplicit !== true && chunker.strategy === 'cdc') {
        observability.log(
          'warn',
          'CDC encrypted store auto-selected deterministic convergent encryption to preserve deduplication',
          {
            strategy: 'cdc',
            selectedScheme: SCHEME_CONVERGENT,
            deterministic: true,
            optOut: 'Use encryption.scheme "framed" or "whole", or encryption.convergent false.',
          },
        );
      }
      return new StoreEncryptionConfig({ scheme: SCHEME_CONVERGENT });
    }
    return StoreEncryptionConfig.resolveFramed(frameBytes);
  }

  static #assertPrereqs({ hasEncryptionKey, scheme, frameBytes }) {
    if (!hasEncryptionKey && (scheme || frameBytes !== undefined)) {
      throw createCasError(
        'encryption options require encryptionKey, passphrase, or recipients',
        ErrorCodes.INVALID_OPTIONS,
        { scheme, frameBytes },
      );
    }
    if (frameBytes !== undefined && scheme === SCHEME_WHOLE) {
      throw createCasError(
        `encryption.frameBytes is not supported for ${scheme} stores`,
        ErrorCodes.INVALID_OPTIONS,
        { scheme, frameBytes },
      );
    }
  }
}
