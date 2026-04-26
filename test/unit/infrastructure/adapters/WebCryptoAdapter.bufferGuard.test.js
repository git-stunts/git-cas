import { describe, it, expect } from 'vitest';
import WebCryptoAdapter from '../../../../src/infrastructure/adapters/WebCryptoAdapter.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import CasError from '../../../../src/domain/errors/CasError.js';

const key = Buffer.alloc(32, 0xab);

async function* makeSource(totalBytes, chunkSize = 1024) {
  let remaining = totalBytes;
  while (remaining > 0) {
    const size = Math.min(chunkSize, remaining);
    yield Buffer.alloc(size, 0xcc);
    remaining -= size;
  }
}

async function consumeStream(encrypt, source) {
  const chunks = [];
  for await (const chunk of encrypt(source)) {
    chunks.push(chunk);
  }
  return chunks;
}

async function consumeDecryptStream(decrypt, source) {
  const chunks = [];
  for await (const chunk of decrypt(source)) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('WebCryptoAdapter — ENCRYPTION_BUFFER_EXCEEDED', () => {
  it('throws ENCRYPTION_BUFFER_EXCEEDED when data exceeds limit', async () => {
    const adapter = new WebCryptoAdapter({ maxEncryptionBufferSize: 2000 });
    const { encrypt } = adapter.createEncryptionStream(key);

    await expect(
      consumeStream(encrypt, makeSource(3000)),
    ).rejects.toThrow(CasError);

    try {
      const adapter2 = new WebCryptoAdapter({ maxEncryptionBufferSize: 2000 });
      const { encrypt: encrypt2 } = adapter2.createEncryptionStream(key);
      await consumeStream(encrypt2, makeSource(3000));
    } catch (err) {
      expect(err.code).toBe('ENCRYPTION_BUFFER_EXCEEDED');
      expect(err.meta.limit).toBe(2000);
    }
  });

  it('succeeds within limit', async () => {
    const adapter = new WebCryptoAdapter({ maxEncryptionBufferSize: 4096 });
    const { encrypt, finalize } = adapter.createEncryptionStream(key);

    const chunks = await consumeStream(encrypt, makeSource(1024));
    expect(chunks.length).toBeGreaterThan(0);

    const meta = finalize();
    expect(meta.encrypted).toBe(true);
  });
});

describe('WebCryptoAdapter — DECRYPTION_BUFFER_EXCEEDED', () => {
  it('throws DECRYPTION_BUFFER_EXCEEDED when ciphertext exceeds limit', async () => {
    const adapter = new WebCryptoAdapter({ maxDecryptionBufferSize: 2000 });
    const { buf, meta } = await adapter.encryptBuffer(Buffer.alloc(3000, 0xdd), key);
    const { decrypt } = adapter.createDecryptionStream(key, meta);

    await expect(
      consumeDecryptStream(decrypt, makeSource(buf.length, 1024)),
    ).rejects.toThrow(CasError);

    try {
      const adapter2 = new WebCryptoAdapter({ maxDecryptionBufferSize: 2000 });
      const { buf: buf2, meta: meta2 } = await adapter2.encryptBuffer(Buffer.alloc(3000, 0xee), key);
      const { decrypt: decrypt2 } = adapter2.createDecryptionStream(key, meta2);
      await consumeDecryptStream(decrypt2, (async function* () {
        yield buf2.subarray(0, 1024);
        yield buf2.subarray(1024);
      })());
    } catch (err) {
      expect(err.code).toBe('DECRYPTION_BUFFER_EXCEEDED');
      expect(err.meta.limit).toBe(2000);
    }
  });

  it('succeeds within decryption limit', async () => {
    const adapter = new WebCryptoAdapter({ maxDecryptionBufferSize: 4096 });
    const plaintext = Buffer.alloc(1024, 0xaa);
    const { buf, meta } = await adapter.encryptBuffer(plaintext, key);
    const { decrypt } = adapter.createDecryptionStream(key, meta);

    const chunks = await consumeDecryptStream(decrypt, (async function* () {
      yield buf.subarray(0, 512);
      yield buf.subarray(512);
    })());

    expect(Buffer.concat(chunks).equals(plaintext)).toBe(true);
  });
});

describe('WebCryptoAdapter — buffer size validation', () => {
  it('throws for NaN', () => {
    expect(() => new WebCryptoAdapter({ maxEncryptionBufferSize: NaN })).toThrow(RangeError);
  });

  it('throws for 0', () => {
    expect(() => new WebCryptoAdapter({ maxEncryptionBufferSize: 0 })).toThrow(RangeError);
  });

  it('throws for negative', () => {
    expect(() => new WebCryptoAdapter({ maxEncryptionBufferSize: -1 })).toThrow(RangeError);
  });

  it('throws for Infinity', () => {
    expect(() => new WebCryptoAdapter({ maxEncryptionBufferSize: Infinity })).toThrow(RangeError);
  });

  it('throws for invalid maxDecryptionBufferSize', () => {
    expect(() => new WebCryptoAdapter({ maxDecryptionBufferSize: 0 })).toThrow(RangeError);
  });
});

describe('NodeCryptoAdapter — no buffer guard for streaming', () => {
  it('does NOT throw for same-size stream (true streaming)', async () => {
    const adapter = new NodeCryptoAdapter();
    const { encrypt, finalize } = adapter.createEncryptionStream(key);

    const chunks = await consumeStream(encrypt, makeSource(3000));
    expect(chunks.length).toBeGreaterThan(0);

    const meta = finalize();
    expect(meta.encrypted).toBe(true);
  });
});
