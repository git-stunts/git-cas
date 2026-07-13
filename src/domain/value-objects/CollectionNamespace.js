import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';

const MAX_COMPONENTS = 16;
const MAX_NAMESPACE_BYTES = 240;
const COMPONENT = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;

/** Immutable namespace shared by managed application collections. */
export default class CollectionNamespace {
  #value;

  constructor(value) {
    if (!CollectionNamespace.isValid(value)) {
      throw createCasError(
        'Collection namespace must be canonical lowercase ASCII',
        ErrorCodes.COLLECTION_NAMESPACE_INVALID,
        { namespace: value },
      );
    }
    this.#value = value;
    Object.freeze(this);
  }

  static from(value) {
    return value instanceof CollectionNamespace ? value : new CollectionNamespace(value);
  }

  static isValid(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_NAMESPACE_BYTES) {
      return false;
    }
    if (!CollectionNamespace.#isAscii(value) || value.includes('..') || value.includes('//')) {
      return false;
    }
    const components = value.split('/');
    return components.length <= MAX_COMPONENTS && components.every(CollectionNamespace.#validComponent);
  }

  static #isAscii(value) {
    return [...value].every((character) => character.codePointAt(0) <= 0x7f);
  }

  static #validComponent(component) {
    return COMPONENT.test(component) &&
      component !== '.' &&
      component !== '..' &&
      !component.endsWith('.lock') &&
      !component.startsWith('git-cas-');
  }

  toString() {
    return this.#value;
  }
}
