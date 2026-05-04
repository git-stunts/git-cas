import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import CryptoPort from '../../../src/ports/CryptoPort.js';

describe('CryptoPort – abstract methods', () => {
  const port = new CryptoPort();

  it('sha256() throws Not implemented', () => {
    expect(() => port.sha256(Buffer.alloc(0))).toThrow('Not implemented');
  });

  it('randomBytes() throws Not implemented', () => {
    expect(() => port.randomBytes(16)).toThrow('Not implemented');
  });

  it('encryptBuffer() throws Not implemented', () => {
    expect(() => port.encryptBuffer(Buffer.alloc(0), Buffer.alloc(32))).toThrow('Not implemented');
  });

  it('decryptBuffer() throws Not implemented', () => {
    expect(() => port.decryptBuffer(Buffer.alloc(0), Buffer.alloc(32), {})).toThrow('Not implemented');
  });

  it('createEncryptionStream() throws Not implemented', () => {
    expect(() => port.createEncryptionStream(Buffer.alloc(32))).toThrow('Not implemented');
  });

  it('createDecryptionStream() throws Not implemented', () => {
    expect(() => port.createDecryptionStream(Buffer.alloc(32), {})).toThrow('Not implemented');
  });

  it('_doDeriveKey() throws Not implemented', async () => {
    await expect(port._doDeriveKey('pass', Buffer.alloc(32), {})).rejects.toThrow('Not implemented');
  });

  it('encryptBufferWithNonce() throws Not implemented', () => {
    expect(() => port.encryptBufferWithNonce(Buffer.alloc(0), Buffer.alloc(32), Buffer.alloc(12))).toThrow('Not implemented');
  });

  it('decryptBufferWithNonceTag() throws Not implemented', () => {
    expect(() => port.decryptBufferWithNonceTag(Buffer.alloc(0), Buffer.alloc(32), Buffer.alloc(12), Buffer.alloc(16))).toThrow('Not implemented');
  });
});

describe('CryptoPort._validateKey()', () => {
  const port = new CryptoPort();

  it('accepts a 32-byte Buffer', () => {
    expect(() => port._validateKey(randomBytes(32))).not.toThrow();
  });

  it('accepts a 32-byte Uint8Array', () => {
    expect(() => port._validateKey(new Uint8Array(32))).not.toThrow();
  });

  it('throws INVALID_KEY_TYPE for a string', () => {
    expect(() => port._validateKey('not-a-buffer')).toThrow('Uint8Array');
    try { port._validateKey('not-a-buffer'); } catch (err) {
      expect(err.code).toBe('INVALID_KEY_TYPE');
    }
  });

  it('throws INVALID_KEY_TYPE for a number', () => {
    expect(() => port._validateKey(42)).toThrow('Uint8Array');
  });

  it('throws INVALID_KEY_LENGTH for wrong length Buffer', () => {
    expect(() => port._validateKey(randomBytes(16))).toThrow('32 bytes');
    try { port._validateKey(randomBytes(16)); } catch (err) {
      expect(err.code).toBe('INVALID_KEY_LENGTH');
      expect(err.meta).toEqual({ expected: 32, actual: 16 });
    }
  });

  it('throws INVALID_KEY_LENGTH for wrong length Uint8Array', () => {
    expect(() => port._validateKey(new Uint8Array(64))).toThrow('32 bytes');
  });
});

describe('CryptoPort._buildMeta()', () => {
  const port = new CryptoPort();

  it('returns correct shape with base64 strings', () => {
    const nonce64 = Buffer.from('test-nonce!!').toString('base64');
    const tag64 = Buffer.from('test-tag-value!!').toString('base64');
    const meta = port._buildMeta(nonce64, tag64);

    expect(meta).toEqual({
      scheme: 'whole',
      algorithm: 'aes-256-gcm',
      nonce: nonce64,
      tag: tag64,
      encrypted: true,
    });
  });
});

describe('CryptoPort.deriveKey() – pbkdf2', () => {
  it('normalizes params and calls _doDeriveKey', async () => {
    const port = new CryptoPort();
    const salt = randomBytes(32);
    const fakeKey = randomBytes(32);
    port.randomBytes = vi.fn().mockReturnValue(salt);
    port._doDeriveKey = vi.fn().mockResolvedValue(fakeKey);

    const result = await port.deriveKey({ passphrase: 'test' });

    expect(port._doDeriveKey).toHaveBeenCalledWith('test', salt, {
      algorithm: 'pbkdf2',
      iterations: 600_000,
      cost: 16384,
      blockSize: 8,
      parallelization: 1,
      keyLength: 32,
    });
    expect(result.key).toEqual(Buffer.from(fakeKey));
    expect(result.salt).toEqual(Buffer.from(salt));
    expect(result.params).toEqual({
      algorithm: 'pbkdf2',
      salt: Buffer.from(salt).toString('base64'),
      keyLength: 32,
      iterations: 600_000,
    });
  });
});

describe('CryptoPort.deriveKey() – scrypt', () => {
  it('normalizes params and calls _doDeriveKey', async () => {
    const port = new CryptoPort();
    const salt = randomBytes(32);
    const fakeKey = randomBytes(32);
    port.randomBytes = vi.fn().mockReturnValue(salt);
    port._doDeriveKey = vi.fn().mockResolvedValue(fakeKey);

    const result = await port.deriveKey({
      passphrase: 'test',
      algorithm: 'scrypt',
    });

    expect(port._doDeriveKey).toHaveBeenCalledWith('test', salt, {
      algorithm: 'scrypt',
      iterations: 600_000,
      cost: 131_072,
      blockSize: 8,
      parallelization: 1,
      keyLength: 32,
    });
    expect(result.params).toEqual({
      algorithm: 'scrypt',
      salt: Buffer.from(salt).toString('base64'),
      keyLength: 32,
      cost: 131_072,
      blockSize: 8,
      parallelization: 1,
    });
  });
});

describe('CryptoPort.deriveKey() – edge cases', () => {
  it('uses provided salt instead of generating one', async () => {
    const port = new CryptoPort();
    const salt = randomBytes(32);
    const fakeKey = randomBytes(32);
    port.randomBytes = vi.fn();
    port._doDeriveKey = vi.fn().mockResolvedValue(fakeKey);

    await port.deriveKey({ passphrase: 'test', salt });

    expect(port.randomBytes).not.toHaveBeenCalled();
    expect(port._doDeriveKey).toHaveBeenCalledWith('test', salt, expect.any(Object));
  });

  it('throws on unsupported algorithm', async () => {
    const port = new CryptoPort();
    port.randomBytes = vi.fn().mockReturnValue(randomBytes(32));

    await expect(
      port.deriveKey({ passphrase: 'test', algorithm: 'argon2' }),
    ).rejects.toThrow('Unsupported KDF algorithm: argon2');
  });
});
