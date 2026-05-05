import { describe, it, expect, vi } from 'vitest';
import FramedRecordCodec from '../../../../src/domain/strategies/FramedRecordCodec.js';
import { encodeBase64 } from '../../../../src/domain/encoding/base64.js';

async function collect(source) {
  const chunks = [];
  for await (const chunk of source) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('FramedRecordCodec', () => {
  it('serializes and parses framed records using Uint8Array metadata', async () => {
    const nonce = new Uint8Array(12).fill(1);
    const tag = new Uint8Array(16).fill(2);
    const crypto = {
      encryptBuffer: vi.fn().mockResolvedValue({
        buf: new Uint8Array([9, 8]),
        meta: { nonce: encodeBase64(nonce), tag: encodeBase64(tag) },
      }),
    };
    const codec = new FramedRecordCodec({ crypto, observability: { metric: vi.fn() } });

    const serialized = await codec.serialize(new Uint8Array([1]), new Uint8Array(32));
    const [record] = await collect(codec.parse((async function* source() { yield serialized; })(), 2));

    expect([...record.ciphertext]).toEqual([9, 8]);
    expect(record.meta).toMatchObject({ encrypted: true, algorithm: 'aes-256-gcm' });
  });

  it('rejects truncated framed records with a domain integrity code', async () => {
    const codec = new FramedRecordCodec({ crypto: {}, observability: { metric: vi.fn() } });

    await expect(collect(codec.parse((async function* source() { yield new Uint8Array([1]); })(), 1024)))
      .rejects.toMatchObject({ code: 'INTEGRITY_ERROR' });
  });
});
