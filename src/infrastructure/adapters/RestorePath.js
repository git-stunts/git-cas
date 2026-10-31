import { realpath } from 'node:fs/promises';
import path from 'node:path';
import CasError from '../../domain/errors/CasError.js';
import { ErrorCodes } from '../../domain/errors/index.js';

const FILE_NOT_FOUND_CODE = 'ENOENT';

/**
 * @param {{ baseDirectory: string, outputPath: string }} options
 * @returns {Promise<string>}
 */
export async function resolveSafeRestorePath({ baseDirectory, outputPath }) {
  const resolvedBase = path.resolve(baseDirectory);
  const resolvedPath = path.resolve(resolvedBase, outputPath);
  const canonicalBase = await realpath(resolvedBase);
  const canonicalPath = await canonicalizeTargetPath(resolvedPath);

  if (!isInsideBaseDirectory(canonicalPath, canonicalBase)) {
    throw new CasError(
      `Restoration path "${outputPath}" escapes base directory "${baseDirectory}"`,
      ErrorCodes.SECURITY_BOUNDARY_VIOLATION,
      { outputPath, baseDirectory }
    );
  }
  return canonicalPath;
}

/**
 * Resolves symlinks in the existing path prefix while allowing the leaf path
 * not to exist yet.
 *
 * @param {string} targetPath
 * @returns {Promise<string>}
 */
async function canonicalizeTargetPath(targetPath) {
  const missingParts = [];
  let current = targetPath;
  while (true) {
    try {
      return path.join(await realpath(current), ...missingParts.reverse());
    } catch (err) {
      if (!isNotFoundError(err)) {
        throw err;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw err;
      }
      missingParts.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * @param {string} resolvedPath
 * @param {string} resolvedBase
 * @returns {boolean}
 */
function isInsideBaseDirectory(resolvedPath, resolvedBase) {
  const relativePath = path.relative(resolvedBase, resolvedPath);
  const escapes = relativePath === '..' || relativePath.startsWith(`..${path.sep}`);
  return !escapes && !path.isAbsolute(relativePath);
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isNotFoundError(err) {
  return Boolean(err && typeof err === 'object' && err.code === FILE_NOT_FOUND_CODE);
}
