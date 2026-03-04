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

describe('WebCryptoAdapter — maxEncryptionBufferSize validation', () => {
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
