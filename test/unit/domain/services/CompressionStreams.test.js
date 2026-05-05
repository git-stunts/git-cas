import { describe, it, expect } from 'vitest';
import CompressionStreams from '../../../../src/domain/services/CompressionStreams.js';

async function collect(source) {
  const chunks = [];
  for await (const chunk of source) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('CompressionStreams', () => {
  it('delegates compression and decompression to the injected adapter', async () => {
    const adapter = {
      async *compressStream() { yield new Uint8Array([1]); },
      async *decompressStream() { yield new Uint8Array([2]); },
    };
    const streams = new CompressionStreams(adapter);

    await expect(collect(streams.compress({}))).resolves.toEqual([new Uint8Array([1])]);
    await expect(collect(streams.decompress({}))).resolves.toEqual([new Uint8Array([2])]);
  });
});
