import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import NodeCryptoAdapter from '../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import WebCryptoAdapter from '../../../src/infrastructure/adapters/WebCryptoAdapter.js';

/**
 * AAD (Additional Authenticated Data) test suite for all crypto adapters.
 *
 * Verifies that AAD is correctly threaded through encryptBuffer, decryptBuffer,
 * createEncryptionStream, and createDecryptionStream for every adapter that
 * runs on the current runtime.
 */

const adapters = [
  ['NodeCryptoAdapter', new NodeCryptoAdapter()],
  ['WebCryptoAdapter', new WebCryptoAdapter()],
];

// BunCryptoAdapter is only available in Bun runtime
if (typeof globalThis.Bun !== 'undefined') {
  const { default: BunCryptoAdapter } = await import(
    '../../../src/infrastructure/adapters/BunCryptoAdapter.js'
  );
  adapters.push(['BunCryptoAdapter', new BunCryptoAdapter()]);
}

const key = randomBytes(32);
const plaintext = Buffer.from('hello content-addressable world');
const aad = Buffer.from('manifest:abc123');
const wrongAad = Buffer.from('manifest:WRONG');

/** @param {AsyncIterable<Buffer>} iterable */
async function collect(iterable) {
  const chunks = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function* toStream(buf) {
  yield buf.subarray(0, 8);
  yield buf.subarray(8);
}

describe.each(adapters)('%s – AAD encryptBuffer/decryptBuffer', (_name, adapter) => {
  it('encrypt with AAD -> decrypt with same AAD -> succeeds', async () => {
    const { buf, meta } = await adapter.encryptBuffer(plaintext, key, aad);
    const result = await Promise.resolve(adapter.decryptBuffer(buf, key, meta, aad));
    expect(Buffer.from(result).equals(plaintext)).toBe(true);
  });

  it('encrypt with AAD -> decrypt with different AAD -> fails', async () => {
    const { buf, meta } = await adapter.encryptBuffer(plaintext, key, aad);
    await expect(
      Promise.resolve().then(() => adapter.decryptBuffer(buf, key, meta, wrongAad)),
    ).rejects.toThrow(/auth|tag|decrypt|Unsupported/i);
  });

  it('encrypt with AAD -> decrypt with no AAD -> fails', async () => {
    const { buf, meta } = await adapter.encryptBuffer(plaintext, key, aad);
    await expect(
      Promise.resolve().then(() => adapter.decryptBuffer(buf, key, meta)),
    ).rejects.toThrow(/auth|tag|decrypt|Unsupported/i);
  });

  it('encrypt with no AAD -> decrypt with AAD -> fails', async () => {
    const { buf, meta } = await adapter.encryptBuffer(plaintext, key);
    await expect(
      Promise.resolve().then(() => adapter.decryptBuffer(buf, key, meta, aad)),
    ).rejects.toThrow(/auth|tag|decrypt|Unsupported/i);
  });

  it('encrypt with no AAD -> decrypt with no AAD -> succeeds (backward compat)', async () => {
    const { buf, meta } = await adapter.encryptBuffer(plaintext, key);
    const result = await Promise.resolve(adapter.decryptBuffer(buf, key, meta));
    expect(Buffer.from(result).equals(plaintext)).toBe(true);
  });
});

describe.each(adapters)('%s – AAD createEncryptionStream/createDecryptionStream', (_name, adapter) => {
  it('stream encrypt with AAD -> stream decrypt with same AAD -> succeeds', async () => {
    const { encrypt, finalize } = adapter.createEncryptionStream(key, aad);
    const ciphertext = await collect(encrypt(toStream(plaintext)));
    const meta = finalize();

    const { decrypt } = adapter.createDecryptionStream(key, meta, aad);
    const result = await collect(decrypt(toStream(ciphertext)));
    expect(result.equals(plaintext)).toBe(true);
  });

  it('stream encrypt with AAD -> stream decrypt with different AAD -> fails', async () => {
    const { encrypt, finalize } = adapter.createEncryptionStream(key, aad);
    const ciphertext = await collect(encrypt(toStream(plaintext)));
    const meta = finalize();

    const { decrypt } = adapter.createDecryptionStream(key, meta, wrongAad);
    await expect(collect(decrypt(toStream(ciphertext)))).rejects.toThrow(/auth|tag|decrypt|Unsupported/i);
  });

  it('stream encrypt with AAD -> stream decrypt with no AAD -> fails', async () => {
    const { encrypt, finalize } = adapter.createEncryptionStream(key, aad);
    const ciphertext = await collect(encrypt(toStream(plaintext)));
    const meta = finalize();

    const { decrypt } = adapter.createDecryptionStream(key, meta);
    await expect(collect(decrypt(toStream(ciphertext)))).rejects.toThrow(/auth|tag|decrypt|Unsupported/i);
  });

  it('stream encrypt with no AAD -> stream decrypt with AAD -> fails', async () => {
    const { encrypt, finalize } = adapter.createEncryptionStream(key);
    const ciphertext = await collect(encrypt(toStream(plaintext)));
    const meta = finalize();

    const { decrypt } = adapter.createDecryptionStream(key, meta, aad);
    await expect(collect(decrypt(toStream(ciphertext)))).rejects.toThrow(/auth|tag|decrypt|Unsupported/i);
  });

  it('stream encrypt with no AAD -> stream decrypt with no AAD -> succeeds (backward compat)', async () => {
    const { encrypt, finalize } = adapter.createEncryptionStream(key);
    const ciphertext = await collect(encrypt(toStream(plaintext)));
    const meta = finalize();

    const { decrypt } = adapter.createDecryptionStream(key, meta);
    const result = await collect(decrypt(toStream(ciphertext)));
    expect(result.equals(plaintext)).toBe(true);
  });
});
