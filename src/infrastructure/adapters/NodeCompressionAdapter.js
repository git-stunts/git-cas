import { gzip, gunzip, createGzip, createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import CompressionPort from '../../ports/CompressionPort.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Node.js compression adapter using `node:zlib` (gzip/gunzip).
 *
 * Provides buffer and streaming compression/decompression via Node's built-in
 * zlib bindings.
 */
export default class NodeCompressionAdapter extends CompressionPort {
  /** @override */
  async compressBuffer(buffer) {
    return gzipAsync(buffer);
  }

  /** @override */
  async decompressBuffer(buffer) {
    return gunzipAsync(buffer);
  }

  /** @override */
  async *compressStream(source) {
    const gz = createGzip();
    const input = Readable.from(source);
    input.on('error', (error) => { gz.destroy(error); });
    input.pipe(gz);
    try {
      for await (const chunk of gz) {
        yield chunk;
      }
    } finally {
      if (!gz.destroyed) { gz.destroy(); }
    }
  }

  /** @override */
  async *decompressStream(source) {
    const gunzipStream = createGunzip();
    const input = Readable.from(source);
    const forwardInputError = (err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      gunzipStream.destroy(error);
    };
    input.on('error', forwardInputError);
    input.pipe(gunzipStream);

    try {
      for await (const chunk of gunzipStream) {
        yield chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      }
    } finally {
      input.removeListener('error', forwardInputError);
      input.destroy();
      if (!gunzipStream.destroyed) {
        gunzipStream.destroy();
      }
    }
  }
}
