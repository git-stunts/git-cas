import StoreOutcome from './StoreOutcome.js';

/**
 * Immutable failed store result.
 */
export default class StoreFailure extends StoreOutcome {
  /**
   * @param {{ error: Error }} options
   */
  constructor({ error }) {
    super({ ok: false });
    this.error = error;
    Object.freeze(this);
  }
}
