import OpaqueHandle from './OpaqueHandle.js';

export const BUNDLE_HANDLE_VERSION = 1;
export const BUNDLE_HANDLE_KIND = 'bundle';
export const BUNDLE_HANDLE_FORMAT = 'fanout-tree';

const SPEC = Object.freeze({
  version: BUNDLE_HANDLE_VERSION,
  kind: BUNDLE_HANDLE_KIND,
  format: BUNDLE_HANDLE_FORMAT,
  label: 'Bundle',
});

/**
 * Immutable, repository-independent locator for one structured bundle tree.
 */
export default class BundleHandle extends OpaqueHandle {
  /** @param {object} value */
  constructor(value) {
    super(value, SPEC);
  }

  /** @param {BundleHandle|string|object} value */
  static from(value) {
    return /** @type {BundleHandle} */ (OpaqueHandle.from(value, BundleHandle, SPEC));
  }

  /** @param {string} token */
  static parse(token) {
    return /** @type {BundleHandle} */ (OpaqueHandle.parse(token, BundleHandle, SPEC));
  }
}
