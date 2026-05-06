/**
 * Base runtime store result.
 */
export default class StoreOutcome {
  /**
   * @param {{ ok: boolean }} options
   */
  constructor({ ok }) {
    this.ok = ok;
  }
}
