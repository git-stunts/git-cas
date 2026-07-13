import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';

/**
 * @param {object} options
 * @param {{ readObjectType(oid: string): Promise<string> }} options.persistence
 * @param {{ toString(): string }} options.handle
 * @param {string} options.oid
 * @param {'blob'|'tree'} options.expectedType
 */
export async function assertHandleObjectType({ persistence, handle, oid, expectedType }) {
  let actualType;
  try {
    actualType = await persistence.readObjectType(oid);
  } catch (error) {
    throw mapHandleTargetError(error, handle, oid);
  }
  if (actualType !== expectedType) {
    throw createCasError(
      'Handle target has the wrong Git object type',
      ErrorCodes.HANDLE_TARGET_TYPE_MISMATCH,
      { handle: handle.toString(), targetOid: oid, expectedType, actualType }
    );
  }
}

/**
 * @param {unknown} error
 * @param {{ toString(): string, oid: string }} handle
 * @param {string} [targetOid]
 */
export function mapHandleTargetError(error, handle, targetOid = handle.oid) {
  if (error?.code === ErrorCodes.HANDLE_TARGET_MISSING) {
    return error;
  }
  const missing =
    error?.code === ErrorCodes.GIT_OBJECT_NOT_FOUND ||
    /(?:object|blob|tree) not found/iu.test(error instanceof Error ? error.message : String(error));
  if (!missing) {
    return error;
  }
  return createCasError(
    'Handle target graph is missing from this repository',
    ErrorCodes.HANDLE_TARGET_MISSING,
    { handle: handle.toString(), targetOid, originalError: error }
  );
}
