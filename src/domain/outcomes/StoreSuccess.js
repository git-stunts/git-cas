import StoreOutcome from './StoreOutcome.js';

/**
 * Immutable successful store result.
 *
 * @typedef {import('../value-objects/Manifest.js').default} Manifest
 */
export default class StoreSuccess extends StoreOutcome {
  /**
   * @param {{ manifest: Manifest }} options
   */
  constructor({ manifest }) {
    super({ ok: true });
    this.manifest = manifest;
    Object.freeze(this);
  }
}
