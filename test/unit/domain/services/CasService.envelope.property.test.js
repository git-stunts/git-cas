import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import CasService from '../../../../src/domain/services/CasService.js';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';
import CasError from '../../../../src/domain/errors/CasError.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import {
  PROPERTY_CONFIG,
  PROPERTY_TIMEOUT_MS,
  envelopePayloadArbitrary,
  envelopeRecipientsArbitrary,
  envelopeTamperFieldArbitrary,
} from '../../../helpers/property.js';

const testCrypto = await getTestCryptoAdapter();

function createService() {
  const blobStore = new Map();
  const crypto = testCrypto;

  const persistence = {
    writeBlob: async (content) => {
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
      const oid = await crypto.sha256(buffer);
      blobStore.set(oid, buffer);
      return oid;
    },
    writeTree: async () => 'mock-tree-oid',
    readBlob: async (oid) => {
      const buffer = blobStore.get(oid);
      if (!buffer) { throw new Error(`Blob not found: ${oid}`); }
      return buffer;
    },
  };

  return new CasService({
    persistence,
    crypto,
    codec: new JsonCodec(),
    chunkSize: 1024,
    observability: new SilentObserver(),
    chunker: new FixedChunker({ chunkSize: 1024 }),
    compressionAdapter: new NodeCompressionAdapter(),
  });
}

async function* bufferSource(buffer) {
  yield buffer;
}

function tamperRecipientField(manifest, field) {
  const json = JSON.parse(JSON.stringify(manifest.toJSON()));
  const encoded = Buffer.from(json.encryption.recipients[0][field], 'base64');
  encoded[0] ^= 0xff;
  json.encryption.recipients[0][field] = encoded.toString('base64');
  return new Manifest(json);
}

function recipientLabels(recipients) {
  return recipients.map((recipient) => recipient.label);
}

function isNoMatchingRecipient(error) {
  return error instanceof CasError && error.code === 'NO_MATCHING_RECIPIENT';
}

async function assertEnvelopeRoundTrip(original, recipients) {
  const service = createService();
  const manifest = await service.store({
    source: bufferSource(original),
    slug: `property-${original.length}-${recipients.length}`,
    filename: 'property.bin',
    recipients,
  });

  expect(manifest.encryption.recipients).toHaveLength(recipients.length);
  expect(recipientLabels(manifest.encryption.recipients)).toEqual(recipientLabels(recipients));

  for (const recipient of recipients) {
    const { buffer } = await service.restore({
      manifest,
      encryptionKey: recipient.key,
    });
    expect(buffer.equals(original)).toBe(true);
  }
}

async function assertEnvelopeTamperFailure(original, recipients, field) {
  const service = createService();
  const manifest = await service.store({
    source: bufferSource(original),
    slug: `tamper-${field}-${original.length}`,
    filename: 'tamper.bin',
    recipients,
  });

  const tamperedManifest = tamperRecipientField(manifest, field);

  await expect(
    service.restore({
      manifest: tamperedManifest,
      encryptionKey: recipients[0].key,
    }),
  ).rejects.toSatisfy(isNoMatchingRecipient);
}

function createEnvelopeRoundTripProperty() {
  return fc.asyncProperty(
    envelopePayloadArbitrary,
    envelopeRecipientsArbitrary,
    assertEnvelopeRoundTrip,
  );
}

function createEnvelopeTamperProperty() {
  return fc.asyncProperty(
    envelopePayloadArbitrary,
    envelopeRecipientsArbitrary,
    envelopeTamperFieldArbitrary,
    assertEnvelopeTamperFailure,
  );
}

describe('CasService – envelope encryption (property)', () => {
  it('round-trips generated payloads for every valid recipient', async () => {
    await fc.assert(createEnvelopeRoundTripProperty(), PROPERTY_CONFIG);
  }, PROPERTY_TIMEOUT_MS);

  it('fails to restore after recipient metadata tampering', async () => {
    await fc.assert(createEnvelopeTamperProperty(), PROPERTY_CONFIG);
  }, PROPERTY_TIMEOUT_MS);
});
