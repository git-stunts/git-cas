/**
 * Immutable store result.
 */
export default class StoreOutcome {
  /**
   * @param {{ manifest: import('../value-objects/Manifest.js').default }} options
   */
  constructor({ manifest }) {
    this.manifest = manifest;
    Object.freeze(this);
  }

  /**
   * @param {import('../value-objects/Manifest.js').default} manifest
   * @returns {StoreOutcome}
   */
  static success(manifest) {
    return new StoreOutcome({ manifest });
  }
}
