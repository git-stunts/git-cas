import OpaqueHandle from './OpaqueHandle.js';

export const PAGE_HANDLE_VERSION = 1;
export const PAGE_HANDLE_KIND = 'page';
export const PAGE_HANDLE_FORMAT = 'blob';
export const PAGE_HANDLE_CODEC = 'raw';

const SPEC = Object.freeze({
  version: PAGE_HANDLE_VERSION,
  kind: PAGE_HANDLE_KIND,
  format: PAGE_HANDLE_FORMAT,
  codec: PAGE_HANDLE_CODEC,
  label: 'Page',
});

/**
 * Immutable, repository-independent locator for one raw page blob.
 */
export default class PageHandle extends OpaqueHandle {
  /** @param {object} value */
  constructor(value) {
    super(value, SPEC);
  }

  /** @param {PageHandle|string|object} value */
  static from(value) {
    return /** @type {PageHandle} */ (OpaqueHandle.from(value, PageHandle, SPEC));
  }

  /** @param {string} token */
  static parse(token) {
    return /** @type {PageHandle} */ (OpaqueHandle.parse(token, PageHandle, SPEC));
  }
}
