import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import AssetHandle from './AssetHandle.js';
import BundleHandle from './BundleHandle.js';
import PageHandle from './PageHandle.js';

const TYPES = Object.freeze({
  asset: AssetHandle,
  bundle: BundleHandle,
  page: PageHandle,
});

/**
 * Parses any supported application-facing content handle.
 *
 * @param {unknown} value
 * @returns {AssetHandle|BundleHandle|PageHandle}
 */
export default function parseApplicationHandle(value) {
  if (value instanceof AssetHandle || value instanceof BundleHandle || value instanceof PageHandle) {
    return value;
  }
  const kind = kindOf(value);
  const Type = TYPES[kind];
  if (!Type) {
    throw createCasError('Handle kind is not supported', ErrorCodes.HANDLE_KIND_MISMATCH, {
      expectedKinds: Object.keys(TYPES),
      actualKind: kind ?? null,
    });
  }
  return Type.from(value);
}

function kindOf(value) {
  if (typeof value === 'string') {
    const fields = value.split(':');
    return fields.length === 7 && fields[0] === 'git-cas' ? fields[2] : null;
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value.kind : null;
}
