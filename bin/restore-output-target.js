import path from 'node:path';
import { createCasError, ErrorCodes } from '../src/domain/errors/index.js';

const OUTPUT_PATH_OPTION = 'outputPath';

/**
 * Resolves an explicit CLI restore target into the absolute path and authority
 * boundary passed to restoreFile().
 *
 * @param {string} outputPath
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @returns {{ outputPath: string, baseDirectory: string }}
 */
export function resolveRestoreOutputTarget(outputPath, { cwd = process.cwd() } = {}) {
  if (typeof outputPath !== 'string' || outputPath.trim() === '') {
    throw createCasError(
      'restore output path must be a non-empty string',
      ErrorCodes.INVALID_OPTIONS,
      { option: OUTPUT_PATH_OPTION },
    );
  }
  const resolvedOutputPath = path.resolve(cwd, outputPath);
  return {
    outputPath: resolvedOutputPath,
    baseDirectory: path.dirname(resolvedOutputPath),
  };
}
