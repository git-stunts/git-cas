import { describe, it, expect, beforeEach } from 'vitest';
import KeyResolver from '../../../../src/domain/services/KeyResolver.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';

/** @type {NodeCryptoAdapter} */
let crypto;
/** @type {KeyResolver} */
let resolver;
/** @type {Buffer} */
let key;
/** @type {Buffer} */
let wrongKey;

beforeEach(() => {
  crypto = new NodeCryptoAdapter();
  resolver = new KeyResolver(crypto);
  key = crypto.randomBytes(32);
  wrongKey = crypto.randomBytes(32);
});

describe('KeyResolver.validateKeySourceExclusive', () => {
  it('throws INVALID_OPTIONS when both provided', () => {
    expect(() => KeyResolver.validateKeySourceExclusive(key, 'secret'))
      .toThrow(expect.objectContaining({ code: 'INVALID_OPTIONS' }));
  });

  it('accepts key-only', () => {
    expect(() => KeyResolver.validateKeySourceExclusive(key, undefined)).not.toThrow();
  });

  it('accepts passphrase-only', () => {
    expect(() => KeyResolver.validateKeySourceExclusive(undefined, 'secret')).not.toThrow();
  });

  it('accepts neither', () => {
    expect(() => KeyResolver.validateKeySourceExclusive(undefined, undefined)).not.toThrow();
  });
});

describe('KeyResolver.wrapDek / unwrapDek', () => {
  it('round-trips: unwrapDek recovers the original DEK', async () => {
    const dek = crypto.randomBytes(32);
    const wrapped = await resolver.wrapDek(dek, key);
    const unwrapped = await resolver.unwrapDek(wrapped, key);
    expect(Buffer.from(unwrapped)).toEqual(dek);
  });

  it('wrong KEK throws DEK_UNWRAP_FAILED', async () => {
    const dek = crypto.randomBytes(32);
    const wrapped = await resolver.wrapDek(dek, key);
    await expect(resolver.unwrapDek(wrapped, wrongKey))
      .rejects.toThrow(expect.objectContaining({ code: 'DEK_UNWRAP_FAILED' }));
  });
});

describe('KeyResolver.resolveForDecryption — direct key', () => {
  it('unencrypted manifest → undefined', async () => {
    const manifest = { encryption: null };
    const result = await resolver.resolveForDecryption(manifest, undefined, undefined);
    expect(result).toBeUndefined();
  });

  it('encrypted manifest + key → returns key', async () => {
    const manifest = { encryption: { encrypted: true } };
    const result = await resolver.resolveForDecryption(manifest, key, undefined);
    expect(Buffer.from(result)).toEqual(key);
  });

  it('encrypted manifest + no key → throws MISSING_KEY', async () => {
    const manifest = { encryption: { encrypted: true } };
    await expect(resolver.resolveForDecryption(manifest, undefined, undefined))
      .rejects.toThrow(expect.objectContaining({ code: 'MISSING_KEY' }));
  });

  it('both ek + pp → throws INVALID_OPTIONS', async () => {
    const manifest = { encryption: { encrypted: true } };
    await expect(resolver.resolveForDecryption(manifest, key, 'secret'))
      .rejects.toThrow(expect.objectContaining({ code: 'INVALID_OPTIONS' }));
  });
});

describe('KeyResolver.resolveForDecryption — envelope & passphrase', () => {
  it('envelope + correct KEK → unwrapped DEK', async () => {
    const dek = crypto.randomBytes(32);
    const wrapped = await resolver.wrapDek(dek, key);
    const manifest = {
      encryption: {
        encrypted: true,
        recipients: [{ label: 'alice', ...wrapped }],
      },
    };
    const result = await resolver.resolveForDecryption(manifest, key, undefined);
    expect(Buffer.from(result)).toEqual(dek);
  });

  it('envelope + wrong KEK → NO_MATCHING_RECIPIENT', async () => {
    const dek = crypto.randomBytes(32);
    const wrapped = await resolver.wrapDek(dek, key);
    const manifest = {
      encryption: {
        encrypted: true,
        recipients: [{ label: 'alice', ...wrapped }],
      },
    };
    await expect(resolver.resolveForDecryption(manifest, wrongKey, undefined))
      .rejects.toThrow(expect.objectContaining({ code: 'NO_MATCHING_RECIPIENT' }));
  });

  it('passphrase + KDF → derived key', async () => {
    const passphrase = 'test-passphrase';
    const derived = await crypto.deriveKey({ passphrase, iterations: 1000 });
    const manifest = {
      encryption: { encrypted: true, kdf: derived.params },
    };
    const result = await resolver.resolveForDecryption(manifest, undefined, passphrase);
    expect(Buffer.from(result)).toEqual(derived.key);
  });

  it('passphrase without KDF → throws MISSING_KEY', async () => {
    const manifest = { encryption: { encrypted: true } };
    await expect(resolver.resolveForDecryption(manifest, undefined, 'secret'))
      .rejects.toThrow(expect.objectContaining({ code: 'MISSING_KEY' }));
  });
});

describe('KeyResolver.resolveForStore', () => {
  it('with key → returns key and empty encExtra', async () => {
    const result = await resolver.resolveForStore(key, undefined, undefined);
    expect(Buffer.from(result.key)).toEqual(key);
    expect(result.encExtra).toEqual({});
  });

  it('with passphrase → returns derived key and kdf encExtra', async () => {
    const result = await resolver.resolveForStore(undefined, 'secret', { iterations: 1000 });
    expect(result.key).toHaveLength(32);
    expect(result.encExtra).toHaveProperty('kdf');
    expect(result.encExtra.kdf).toHaveProperty('algorithm', 'pbkdf2');
    expect(result.encExtra.kdf).toHaveProperty('salt');
  });

  it('with neither → returns undefined key and empty encExtra', async () => {
    const result = await resolver.resolveForStore(undefined, undefined, undefined);
    expect(result.key).toBeUndefined();
    expect(result.encExtra).toEqual({});
  });
});

describe('KeyResolver.resolveRecipients', () => {
  it('generates DEK + wrapped entries', async () => {
    const k1 = crypto.randomBytes(32);
    const k2 = crypto.randomBytes(32);
    const recipients = [
      { label: 'alice', key: k1 },
      { label: 'bob', key: k2 },
    ];

    const result = await resolver.resolveRecipients(recipients);
    expect(result.key).toHaveLength(32);
    expect(result.encExtra.recipients).toHaveLength(2);
    expect(result.encExtra.recipients[0]).toHaveProperty('label', 'alice');
    expect(result.encExtra.recipients[0]).toHaveProperty('wrappedDek');
    expect(result.encExtra.recipients[1]).toHaveProperty('label', 'bob');

    // Verify each recipient can unwrap the DEK
    for (let i = 0; i < recipients.length; i++) {
      const dek = await resolver.unwrapDek(result.encExtra.recipients[i], recipients[i].key);
      expect(Buffer.from(dek)).toEqual(result.key);
    }
  });

  it('empty recipients → INVALID_OPTIONS', async () => {
    await expect(resolver.resolveRecipients([]))
      .rejects.toThrow(expect.objectContaining({ code: 'INVALID_OPTIONS' }));
  });

  it('non-array → INVALID_OPTIONS', async () => {
    await expect(resolver.resolveRecipients(null))
      .rejects.toThrow(expect.objectContaining({ code: 'INVALID_OPTIONS' }));
  });

  it('duplicate labels → INVALID_OPTIONS', async () => {
    const k = crypto.randomBytes(32);
    await expect(resolver.resolveRecipients([
      { label: 'alice', key: k },
      { label: 'alice', key: k },
    ])).rejects.toThrow(expect.objectContaining({ code: 'INVALID_OPTIONS' }));
  });
});

describe('KeyResolver.resolveKeyForRecipients', () => {
  it('correct key unwraps DEK from recipients', async () => {
    const dek = crypto.randomBytes(32);
    const wrapped = await resolver.wrapDek(dek, key);
    const manifest = {
      encryption: {
        recipients: [{ label: 'alice', ...wrapped }],
      },
    };
    const result = await resolver.resolveKeyForRecipients(manifest, key);
    expect(Buffer.from(result)).toEqual(dek);
  });

  it('wrong key → NO_MATCHING_RECIPIENT', async () => {
    const dek = crypto.randomBytes(32);
    const wrapped = await resolver.wrapDek(dek, key);
    const manifest = {
      encryption: {
        recipients: [{ label: 'alice', ...wrapped }],
      },
    };
    await expect(resolver.resolveKeyForRecipients(manifest, wrongKey))
      .rejects.toThrow(expect.objectContaining({ code: 'NO_MATCHING_RECIPIENT' }));
  });

  it('no recipients → returns key directly', async () => {
    const manifest = { encryption: {} };
    const result = await resolver.resolveKeyForRecipients(manifest, key);
    expect(Buffer.from(result)).toEqual(key);
  });
});
