import StoreOutcome from './StoreOutcome.js';

/**
 * Immutable successful store result.
 */
export default class StoreSuccess extends StoreOutcome {
  /**
   * @param {{ manifest: import('../value-objects/Manifest.js').default }} options
   */
  constructor({ manifest }) {
    super({ ok: true });
    this.manifest = manifest;
    Object.freeze(this);
  }
}
