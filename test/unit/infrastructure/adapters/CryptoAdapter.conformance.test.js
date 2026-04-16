import { describe, it, expect } from 'vitest';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import WebCryptoAdapter from '../../../../src/infrastructure/adapters/WebCryptoAdapter.js';

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

async function expectStreamDecryptRoundTrip(adapter, key) {
  const plaintext = Buffer.from('stream me back');
  const { buf, meta } = await adapter.encryptBuffer(plaintext, key);
  const { decrypt } = adapter.createDecryptionStream(key, meta);
  const chunks = [];

  async function* source() {
    yield buf.subarray(0, 4);
    yield buf.subarray(4);
  }

  for await (const chunk of decrypt(source())) {
    chunks.push(chunk);
  }

  expect(Buffer.concat(chunks).equals(plaintext)).toBe(true);
}

async function expectInvalidDecryptMeta(adapter, key, mutateMeta) {
  const { buf, meta } = await adapter.encryptBuffer(Buffer.from('test'), key);
  await expect(
    Promise.resolve().then(() => adapter.decryptBuffer(buf, key, mutateMeta(meta))),
  ).rejects.toMatchObject({
    code: 'INTEGRITY_ERROR',
    meta: expect.objectContaining({ reason: 'invalid-encryption-meta' }),
  });
}

async function expectInvalidStreamMeta(adapter, key, mutateMeta) {
  const { meta } = await adapter.encryptBuffer(Buffer.from('test'), key);
  expect(() => adapter.createDecryptionStream(key, mutateMeta(meta))).toThrow(
    expect.objectContaining({
      code: 'INTEGRITY_ERROR',
      meta: expect.objectContaining({ reason: 'invalid-encryption-meta' }),
    }),
  );
}

function registerKeyValidationTests(adapter, key) {
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
    ).rejects.toMatchObject({ code: 'INVALID_KEY_TYPE' });
  });

  it('decryptBuffer rejects INVALID_KEY_LENGTH for 16-byte key', async () => {
    const shortKey = Buffer.alloc(16, 0xcc);
    const { buf, meta } = await adapter.encryptBuffer(Buffer.from('test'), key);
    await expect(
      Promise.resolve().then(() => adapter.decryptBuffer(buf, shortKey, meta)),
    ).rejects.toMatchObject({ code: 'INVALID_KEY_LENGTH' });
  });
}

function registerStreamingTests(adapter, key) {
  it('createEncryptionStream.finalize() throws STREAM_NOT_CONSUMED before consumption', () => {
    const { finalize } = adapter.createEncryptionStream(key);
    expect(() => finalize()).toThrow(
      expect.objectContaining({ code: 'STREAM_NOT_CONSUMED' }),
    );
  });

  it('createDecryptionStream round-trips streamed ciphertext', async () => {
    await expectStreamDecryptRoundTrip(adapter, key);
  });
}

function registerInvalidMetaTests(adapter, key) {
  it('decryptBuffer rejects a non-AES-GCM algorithm at the adapter boundary', async () => {
    await expectInvalidDecryptMeta(adapter, key, (meta) => ({
      ...meta,
      algorithm: 'aes-128-cbc',
    }));
  });

  it('decryptBuffer rejects short auth tags before runtime decrypt', async () => {
    await expectInvalidDecryptMeta(adapter, key, (meta) => ({
      ...meta,
      tag: Buffer.alloc(8, 0x55).toString('base64'),
    }));
  });

  it('createDecryptionStream rejects malformed nonce metadata immediately', async () => {
    await expectInvalidStreamMeta(adapter, key, (meta) => ({
      ...meta,
      nonce: '%%%bad-base64%%%',
    }));
  });
}

describe.each(adapters)('%s conformance', (_name, adapter) => {
  const key = Buffer.alloc(32, 0xab);

  registerKeyValidationTests(adapter, key);
  registerStreamingTests(adapter, key);
  registerInvalidMetaTests(adapter, key);
});
