/**
 * @fileoverview Loads `.casrc` project config from the Git working directory.
 *
 * `.casrc` is a JSON file placed at the repository root that provides default
 * values for CLI flags. CLI flags always take precedence over `.casrc` values.
 *
 * Supported keys:
 *   chunkSize      — Chunk size in bytes (integer >= 1024, default 262144)
 *   strategy       — Chunking strategy: "fixed" or "cdc" (default "fixed")
 *   concurrency    — Parallel chunk I/O operations (positive integer, default 1)
 *   codec          — Manifest codec: "json" or "cbor" (default "json")
 *   compression    — Compression algorithm: "gzip" or false (default false)
 *   merkleThreshold — Chunk count threshold for Merkle sub-manifests (default 1000)
 *   maxRestoreBufferSize — Max bytes for buffered restore (default 536870912)
 *   cdc.minChunkSize     — CDC minimum chunk size
 *   cdc.targetChunkSize  — CDC target chunk size
 *   cdc.maxChunkSize     — CDC maximum chunk size
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILENAME = '.casrc';
const MAX_CHUNK_SIZE = 100 * 1024 * 1024;

/**
 * @typedef {Object} CasConfig
 * @property {number} [chunkSize]
 * @property {string} [strategy]
 * @property {number} [concurrency]
 * @property {string} [codec]
 * @property {string|false} [compression]
 * @property {number} [merkleThreshold]
 * @property {number} [maxRestoreBufferSize]
 * @property {{ minChunkSize?: number, targetChunkSize?: number, maxChunkSize?: number }} [cdc]
 */

/**
 * @param {any} value
 * @param {string} name
 * @param {{ min: number, max?: number }} range
 */
function assertInt(value, name, { min, max }) {
  if (value === undefined) { return; }
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${FILENAME}: ${name} must be an integer >= ${min}`);
  }
  if (max !== undefined && value > max) {
    throw new Error(`${FILENAME}: ${name} must not exceed ${max}`);
  }
}

/**
 * @param {any} value
 * @param {string} name
 * @param {string[]} allowed
 */
function assertEnum(value, name, allowed) {
  if (value === undefined) { return; }
  if (!allowed.includes(value)) {
    throw new Error(`${FILENAME}: ${name} must be ${allowed.map((v) => `"${v}"`).join(' or ')}`);
  }
}

/**
 * @param {Record<string, any>} config
 */
/**
 * @param {{ minChunkSize?: number, targetChunkSize?: number, maxChunkSize?: number }} cdc
 */
function assertCdcOrdering(cdc) {
  const { minChunkSize, targetChunkSize, maxChunkSize } = cdc;
  if (minChunkSize !== undefined && maxChunkSize !== undefined && minChunkSize > maxChunkSize) {
    throw new Error(`${FILENAME}: cdc.minChunkSize must not exceed cdc.maxChunkSize`);
  }
  if (targetChunkSize !== undefined && minChunkSize !== undefined && targetChunkSize < minChunkSize) {
    throw new Error(`${FILENAME}: cdc.targetChunkSize must be >= cdc.minChunkSize`);
  }
  if (targetChunkSize !== undefined && maxChunkSize !== undefined && targetChunkSize > maxChunkSize) {
    throw new Error(`${FILENAME}: cdc.targetChunkSize must be <= cdc.maxChunkSize`);
  }
}

/**
 * @param {Record<string, any>} config
 */
function validateCdc(config) {
  if (config.cdc === undefined) { return; }
  if (typeof config.cdc !== 'object' || config.cdc === null || Array.isArray(config.cdc)) {
    throw new Error(`${FILENAME}: cdc must be an object`);
  }
  for (const key of ['minChunkSize', 'targetChunkSize', 'maxChunkSize']) {
    assertInt(config.cdc[key], `cdc.${key}`, { min: 1, max: MAX_CHUNK_SIZE });
  }
  assertCdcOrdering(config.cdc);
}

/**
 * Validates `.casrc` config values after parsing.
 *
 * @param {Record<string, any>} config
 */
function validateConfig(config) {
  assertInt(config.chunkSize, 'chunkSize', { min: 1024, max: MAX_CHUNK_SIZE });
  assertEnum(config.strategy, 'strategy', ['fixed', 'cdc']);
  assertInt(config.concurrency, 'concurrency', { min: 1 });
  assertEnum(config.codec, 'codec', ['json', 'cbor']);
  if (config.compression !== undefined && config.compression !== false) {
    assertEnum(config.compression, 'compression', ['gzip']);
  }
  assertInt(config.merkleThreshold, 'merkleThreshold', { min: 1 });
  assertInt(config.maxRestoreBufferSize, 'maxRestoreBufferSize', { min: 1024 });
  validateCdc(config);
}

/**
 * Loads `.casrc` from the given directory, returning an empty object if not found.
 *
 * @param {string} cwd - Directory to search for `.casrc`.
 * @returns {CasConfig}
 */
export function loadConfig(cwd) {
  const filePath = resolve(cwd, FILENAME);
  try {
    const raw = readFileSync(filePath, 'utf8');
    const config = JSON.parse(raw);
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      throw new Error(`${FILENAME}: expected a JSON object`);
    }
    validateConfig(config);
    return config;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {};
    }
    if (err instanceof SyntaxError) {
      throw new Error(`${FILENAME}: invalid JSON — ${err.message}`);
    }
    throw err;
  }
}

/**
 * Sets key on target if value is not undefined.
 * @param {Record<string, any>} target
 * @param {string} key
 * @param {any} value
 */
function setIfDefined(target, key, value) {
  if (value !== undefined) { target[key] = value; }
}

/**
 * Resolves chunking config from merged CLI + config values.
 * @param {{ strategy?: string, chunkSize?: number, cliOpts: Record<string, any>, config: CasConfig }} opts
 * @returns {Record<string, any>|undefined}
 */
function resolveChunking({ strategy, chunkSize, cliOpts, config }) {
  if (strategy === 'cdc') {
    const cdcConf = config.cdc || {};
    return {
      strategy: 'cdc',
      targetChunkSize: cliOpts.targetChunkSize ?? cdcConf.targetChunkSize,
      minChunkSize: cliOpts.minChunkSize ?? cdcConf.minChunkSize,
      maxChunkSize: cliOpts.maxChunkSize ?? cdcConf.maxChunkSize,
    };
  }
  if (strategy === 'fixed' && chunkSize !== undefined) {
    return { strategy: 'fixed', chunkSize };
  }
  return undefined;
}

/**
 * Merges CLI options over `.casrc` defaults. CLI flags take precedence.
 *
 * @param {Record<string, any>} cliOpts - Parsed CLI options.
 * @param {CasConfig} config - Loaded `.casrc` config.
 * @returns {{ casConfig: Record<string, any>, storeExtras: Record<string, any> }}
 */
export function mergeConfig(cliOpts, config) {
  const strategy = cliOpts.strategy ?? config.strategy;
  const chunkSize = cliOpts.chunkSize ?? config.chunkSize;

  /** @type {Record<string, any>} */
  const casConfig = {};
  setIfDefined(casConfig, 'concurrency', cliOpts.concurrency ?? config.concurrency);
  setIfDefined(casConfig, 'chunkSize', chunkSize);
  setIfDefined(casConfig, 'merkleThreshold', cliOpts.merkleThreshold ?? config.merkleThreshold);
  setIfDefined(casConfig, 'maxRestoreBufferSize', cliOpts.maxRestoreBufferSize ?? config.maxRestoreBufferSize);
  setIfDefined(casConfig, 'chunking', resolveChunking({ strategy, chunkSize, cliOpts, config }));

  const codec = cliOpts.codec ?? config.codec;
  if (codec === 'cbor') { casConfig.codec = 'cbor'; }

  /** @type {Record<string, any>} */
  const storeExtras = {};
  if (cliOpts.gzip || config.compression === 'gzip') {
    storeExtras.compression = { algorithm: 'gzip' };
  }

  return { casConfig, storeExtras };
}
