import CasError from '../domain/errors/CasError.js';
import { isCanonicalBase64 } from './canonicalBase64.js';
import { base64DecodedLength } from '../domain/encoding/base64.js';

export const DEFAULT_PBKDF2_ITERATIONS = 600_000;
export const DEFAULT_SCRYPT_COST = 131_072;
export const DEFAULT_SCRYPT_BLOCK_SIZE = 8;
export const DEFAULT_SCRYPT_PARALLELIZATION = 1;
export const DEFAULT_KDF_KEY_LENGTH = 32;
export const LEGACY_SCRYPT_COST = 16_384;

const MIN_PBKDF2_ITERATIONS = 100_000;
const MAX_PBKDF2_ITERATIONS = 2_000_000;
const MIN_SCRYPT_COST = 16_384;
const MAX_SCRYPT_COST = 1_048_576;
const MIN_SCRYPT_BLOCK_SIZE = 8;
const MAX_SCRYPT_BLOCK_SIZE = 32;
const MIN_SCRYPT_PARALLELIZATION = 1;
const MAX_SCRYPT_PARALLELIZATION = 16;

/** Maximum combined scrypt memory budget: 1 GiB (128 * cost * blockSize). */
const MAX_SCRYPT_MEMORY = 1024 * 1024 * 1024;

function buildPolicyError(message, meta) {
  throw new CasError(message, 'KDF_POLICY_VIOLATION', meta);
}

function assertSupportedAlgorithm(algorithm) {
  if (algorithm !== 'pbkdf2' && algorithm !== 'scrypt') {
    throw new Error(`Unsupported KDF algorithm: ${algorithm}`);
  }
}

function normalizeCost(algorithm, cost) {
  if (cost !== undefined) {
    return cost;
  }
  return algorithm === 'scrypt' ? DEFAULT_SCRYPT_COST : LEGACY_SCRYPT_COST;
}

function assertFiniteInteger(value, field, source) {
  if (!Number.isInteger(value) || value <= 0) {
    buildPolicyError(
      `${source} KDF field "${field}" must be a positive integer`,
      { source, field, value },
    );
  }
}

function assertCanonicalBase64(value, field, source) {
  if (typeof value !== 'string' || value.length === 0 || !isCanonicalBase64(value)) {
    buildPolicyError(
      `${source} KDF field "${field}" must be canonical base64`,
      { source, field, value },
    );
  }
}

function assertRange({ value, field, min, max, source }) {
  assertFiniteInteger(value, field, source);
  if (value < min || value > max) {
    buildPolicyError(
      `${source} KDF field "${field}" must be between ${min} and ${max}`,
      { source, field, value, min, max },
    );
  }
}

function assertKeyLength(keyLength, source) {
  assertFiniteInteger(keyLength, 'keyLength', source);
  if (keyLength !== DEFAULT_KDF_KEY_LENGTH) {
    buildPolicyError(
      `${source} KDF keyLength must be ${DEFAULT_KDF_KEY_LENGTH}`,
      { source, field: 'keyLength', value: keyLength, expected: DEFAULT_KDF_KEY_LENGTH },
    );
  }
}

function assertScryptCost(cost, source) {
  assertRange({
    value: cost,
    field: 'cost',
    min: MIN_SCRYPT_COST,
    max: MAX_SCRYPT_COST,
    source,
  });
  if ((cost & (cost - 1)) !== 0) {
    buildPolicyError(
      `${source} scrypt cost must be a power of two`,
      { source, field: 'cost', value: cost },
    );
  }
}

export function normalizeKdfOptions(options = {}) {
  const algorithm = options.algorithm ?? 'pbkdf2';
  assertSupportedAlgorithm(algorithm);
  return {
    algorithm,
    iterations: options.iterations ?? DEFAULT_PBKDF2_ITERATIONS,
    cost: normalizeCost(algorithm, options.cost),
    blockSize: options.blockSize ?? DEFAULT_SCRYPT_BLOCK_SIZE,
    parallelization: options.parallelization ?? DEFAULT_SCRYPT_PARALLELIZATION,
    keyLength: options.keyLength ?? DEFAULT_KDF_KEY_LENGTH,
  };
}

function requireField(value, field, source) {
  if (value === undefined) {
    buildPolicyError(
      `${source} KDF field "${field}" is required`,
      { source, field, value },
    );
  }
  return value;
}

export function assertKdfPolicy(params, { source }) {
  if (params.algorithm === 'pbkdf2') {
    assertRange({
      value: requireField(params.iterations, 'iterations', source),
      field: 'iterations',
      min: MIN_PBKDF2_ITERATIONS,
      max: MAX_PBKDF2_ITERATIONS,
      source,
    });
    assertKeyLength(params.keyLength, source);
    return;
  }

  if (params.algorithm === 'scrypt') {
    assertScryptCost(requireField(params.cost, 'cost', source), source);
    assertRange({
      value: requireField(params.blockSize, 'blockSize', source),
      field: 'blockSize',
      min: MIN_SCRYPT_BLOCK_SIZE,
      max: MAX_SCRYPT_BLOCK_SIZE,
      source,
    });
    assertRange(
      {
        value: requireField(params.parallelization, 'parallelization', source),
        field: 'parallelization',
        min: MIN_SCRYPT_PARALLELIZATION,
        max: MAX_SCRYPT_PARALLELIZATION,
        source,
      },
    );
    assertKeyLength(params.keyLength, source);

    const memoryBytes = 128 * params.cost * params.blockSize;
    if (memoryBytes > MAX_SCRYPT_MEMORY) {
      buildPolicyError(
        `${source} scrypt memory budget exceeds ${MAX_SCRYPT_MEMORY} bytes (128 × ${params.cost} × ${params.blockSize} = ${memoryBytes})`,
        { source, field: 'memory', cost: params.cost, blockSize: params.blockSize, memoryBytes },
      );
    }
    return;
  }
  assertSupportedAlgorithm(params.algorithm);
}

export function prepareKdfOptions(kdfOptions, { source }) {
  const normalized = normalizeKdfOptions(kdfOptions);
  assertKdfPolicy(normalized, { source });
  return normalized;
}

const MIN_SALT_BYTES = 16;

export function prepareStoredKdfOptions(kdf, { source }) {
  assertCanonicalBase64(kdf.salt, 'salt', source);
  const saltBytes = base64DecodedLength(kdf.salt);
  if (saltBytes < MIN_SALT_BYTES) {
    buildPolicyError(
      `${source} KDF salt must be at least ${MIN_SALT_BYTES} bytes, got ${saltBytes}`,
      { source, field: 'salt', saltBytes, minSaltBytes: MIN_SALT_BYTES },
    );
  }
  const params = {
    algorithm: kdf.algorithm,
    iterations: kdf.iterations,
    cost: kdf.cost,
    blockSize: kdf.blockSize,
    parallelization: kdf.parallelization,
    keyLength: kdf.keyLength,
  };
  assertKdfPolicy(params, { source });
  return params;
}
