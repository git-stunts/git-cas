import { describe, it, expect, vi } from 'vitest';
import createCasError from '../../../../src/domain/errors/createCasError.js';
import { ErrorCodes } from '../../../../src/domain/errors/index.js';
import RecipientService from '../../../../src/domain/services/RecipientService.js';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';

function b64(size, fill) {
  return Buffer.alloc(size, fill).toString('base64');
}

function makeRecipient(label, fill) {
  return {
    label,
    wrappedDek: b64(32, fill),
    nonce: b64(12, fill),
    tag: b64(16, fill),
  };
}

function makeEnvelopeManifest() {
  return new Manifest({
    version: 1,
    slug: 'secure/asset',
    filename: 'asset.bin',
    size: 1,
    chunks: [{ index: 0, size: 1, digest: 'a'.repeat(64), blob: 'b'.repeat(40) }],
    encryption: {
      scheme: 'whole',
      algorithm: 'aes-256-gcm',
      encrypted: true,
      nonce: b64(12, 1),
      tag: b64(16, 2),
      recipients: [
        makeRecipient('alice', 3),
        makeRecipient('bob', 4),
        makeRecipient('carol', 5),
      ],
    },
  });
}

describe('RecipientService', () => {
  it('lists recipient labels from envelope metadata', () => {
    const service = new RecipientService({ crypto: {}, keyResolver: {} });
    const manifest = {
      encryption: {
        recipients: [
          { label: 'alice' },
        ],
      },
    };

    expect(service.listRecipients(manifest)).toEqual(['alice']);
  });
});

describe('RecipientService key rotation', () => {
  it('continues scanning recipients during unlabeled key rotation after a match', async () => {
    const oldKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const newKey = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
    const dek = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const unwrapFailure = createCasError('not this recipient', ErrorCodes.DEK_UNWRAP_FAILED);
    const keyResolver = {
      unwrapDek: vi.fn(async (recipient) => {
        if (recipient.label === 'alice') {
          return dek;
        }
        throw unwrapFailure;
      }),
      wrapDek: vi.fn(async () => ({
        wrappedDek: b64(32, 9),
        nonce: b64(12, 8),
        tag: b64(16, 7),
      })),
    };
    const service = new RecipientService({
      crypto: { _validateKey: vi.fn() },
      keyResolver,
    });

    const rotated = await service.rotateKey({
      manifest: makeEnvelopeManifest(),
      oldKey,
      newKey,
    });

    expect(keyResolver.unwrapDek.mock.calls.map(([recipient]) => recipient.label)).toEqual([
      'alice',
      'bob',
      'carol',
    ]);
    expect(rotated.encryption.recipients[0].wrappedDek).toBe(b64(32, 9));
  });
});
