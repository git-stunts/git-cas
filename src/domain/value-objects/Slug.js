import CasError from '../errors/CasError.js';
import { utf8ByteLength } from '../encoding/utf8.js';

/**
 * Immutable domain value object for user-facing CAS/vault slugs.
 */
export default class Slug {
  /** @type {string} */
  #value;

  /**
   * @param {string} value
   */
  constructor(value) {
    Slug.validate(value);
    this.#value = value;
    Object.freeze(this);
  }

  /**
   * @param {string | Slug} value
   * @returns {Slug}
   */
  static from(value) {
    return value instanceof Slug ? value : new Slug(value);
  }

  /**
   * Validates a slug string.
   *
   * @param {unknown} slug
   * @throws {CasError} INVALID_SLUG when the slug is not valid.
   */
  static validate(slug) {
    if (typeof slug !== 'string' || slug.length === 0) {
      throw new CasError('Slug must be a non-empty string', 'INVALID_SLUG', { slug });
    }
    if (slug.startsWith('/') || slug.endsWith('/')) {
      throw new CasError('Slug must not start or end with "/"', 'INVALID_SLUG', { slug });
    }
    if (utf8ByteLength(slug) > 1024) {
      throw new CasError('Slug exceeds 1024 bytes total', 'INVALID_SLUG', { slug });
    }
    for (const segment of slug.split('/')) {
      Slug.#validateSegment(segment, slug);
    }
  }

  /**
   * @param {string} segment
   * @param {string} slug
   */
  static #validateSegment(segment, slug) {
    if (segment.length === 0) {
      throw new CasError('Slug contains empty segment', 'INVALID_SLUG', { slug });
    }
    if (segment === '.' || segment === '..') {
      throw new CasError('Slug contains "." or ".." segment', 'INVALID_SLUG', { slug });
    }
    if (utf8ByteLength(segment) > 255) {
      throw new CasError('Slug segment exceeds 255 bytes', 'INVALID_SLUG', { slug });
    }
    if (Slug.hasControlChars(segment)) {
      throw new CasError('Slug contains control characters', 'INVALID_SLUG', { slug });
    }
  }

  /**
   * @param {string} value
   * @returns {boolean}
   */
  static hasControlChars(value) {
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code <= 0x1f || code === 0x7f) {
        return true;
      }
    }
    return false;
  }

  /**
   * Percent-encodes a slug for use as one Git tree entry name.
   *
   * @param {string | Slug} slug
   * @returns {string}
   */
  static encode(slug) {
    const value = Slug.from(slug).toString();
    if (Slug.hasControlChars(value)) {
      throw new CasError(
        'Slug contains control characters — refusing to encode for mktree',
        'INVALID_SLUG',
        { slug: value },
      );
    }
    return value.replaceAll('%', '%25').replaceAll('/', '%2F');
  }

  /**
   * Decodes a percent-encoded Git tree entry name back to a slug.
   *
   * @param {string} treePath
   * @returns {string}
   */
  static decode(treePath) {
    return treePath.replaceAll('%2F', '/').replaceAll('%25', '%');
  }

  /**
   * @returns {string}
   */
  toString() {
    return this.#value;
  }

  /**
   * @returns {string}
   */
  toTreePath() {
    return Slug.encode(this);
  }
}
