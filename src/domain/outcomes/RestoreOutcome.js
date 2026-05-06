/**
 * Base runtime restore result.
 */
export default class RestoreOutcome {
  /**
   * @param {{ ok: boolean }} options
   */
  constructor({ ok }) {
    this.ok = ok;
  }
}
