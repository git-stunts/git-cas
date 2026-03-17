import fc from 'fast-check';

export const PROPERTY_SEED = 5333;
export const PROPERTY_RUNS = 25;
export const PROPERTY_TIMEOUT_MS = 30_000;
export const PROPERTY_CONFIG = {
  seed: PROPERTY_SEED,
  numRuns: PROPERTY_RUNS,
};

const ENVELOPE_SIZES = [
  0,
  1,
  1023,
  1024,
  1025,
  2047,
  2048,
  2049,
  3072,
  4096,
];

const recipientKeyHexArbitrary = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((bytes) => Buffer.from(bytes).toString('hex'));

export const envelopePayloadArbitrary = fc
  .constantFrom(...ENVELOPE_SIZES)
  .chain((size) => fc.uint8Array({ minLength: size, maxLength: size }))
  .map((bytes) => Buffer.from(bytes));

export const envelopeRecipientsArbitrary = fc
  .uniqueArray(recipientKeyHexArbitrary, { minLength: 1, maxLength: 4 })
  .map((hexKeys) => hexKeys.map((hex, index) => ({
    label: `recipient-${index}`,
    key: Buffer.from(hex, 'hex'),
  })));

export const envelopeTamperFieldArbitrary = fc.constantFrom('wrappedDek', 'nonce', 'tag');
