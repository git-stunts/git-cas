import { describe, it, expect } from 'vitest';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import WebCryptoAdapter from '../../../../src/infrastructure/adapters/WebCryptoAdapter.js';
import CasError from '../../../../src/domain/errors/CasError.js';

/**
 * Conformance test suite that asserts identical behavioral contracts across
 * all crypto adapters that can run in the current environment.
 */

const adapters = [
  ['NodeCryptoAdapter', new NodeCryptoAdapter()],
  ['WebCryptoAdapter', new WebCryptoAdapter()],
];

// BunCryptoAdapter is only available in Bun runtime — skip in Node/Deno
if (typeof globalThis.Bun !== 'undefined') {
  const { default: BunCryptoAdapter } = await import(
    '../../../../src/infrastructure/adapters/BunCryptoAdapter.js'
  );
  adapters.push(['BunCryptoAdapter', new BunCryptoAdapter()]);
}

describe.each(adapters)('%s conformance', (_name, adapter) => {
  const key = Buffer.alloc(32, 0xab);

  it('encryptBuffer returns a Promise (thenable)', async () => {
    const result = adapter.encryptBuffer(Buffer.from('hello'), key);
    expect(typeof result.then).toBe('function');
    const { buf, meta } = await result;
    expect(buf).toBeInstanceOf(Buffer);
    expect(meta.encrypted).toBe(true);
  });

  it('decryptBuffer rejects INVALID_KEY_TYPE for string key', async () => {
    const { buf, meta } = await adapter.encryptBuffer(Buffer.from('test'), key);
    await expect(
      Promise.resolve().then(() => adapter.decryptBuffer(buf, 'not-a-buffer', meta)),
    ).rejects.toThrow(CasError);

    try {
      await Promise.resolve().then(() => adapter.decryptBuffer(buf, 'not-a-buffer', meta));
    } catch (err) {
      expect(err.code).toBe('INVALID_KEY_TYPE');
    }
  });

  it('decryptBuffer rejects INVALID_KEY_LENGTH for 16-byte key', async () => {
    const shortKey = Buffer.alloc(16, 0xcc);
    const { buf, meta } = await adapter.encryptBuffer(Buffer.from('test'), key);
    await expect(
      Promise.resolve().then(() => adapter.decryptBuffer(buf, shortKey, meta)),
    ).rejects.toThrow(CasError);

    try {
      await Promise.resolve().then(() => adapter.decryptBuffer(buf, shortKey, meta));
    } catch (err) {
      expect(err.code).toBe('INVALID_KEY_LENGTH');
    }
  });

  it('createEncryptionStream.finalize() throws STREAM_NOT_CONSUMED before consumption', () => {
    const { finalize } = adapter.createEncryptionStream(key);
    expect(() => finalize()).toThrow(CasError);

    try {
      finalize();
    } catch (err) {
      expect(err.code).toBe('STREAM_NOT_CONSUMED');
    }
  });
});
