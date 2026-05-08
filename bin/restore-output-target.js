import path from 'node:path';

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
  const resolvedOutputPath = path.resolve(cwd, outputPath);
  return {
    outputPath: resolvedOutputPath,
    baseDirectory: path.dirname(resolvedOutputPath),
  };
}
