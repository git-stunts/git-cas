import RestoreOutcome from './RestoreOutcome.js';

/**
 * Immutable failed restore result.
 */
export default class RestoreFailure extends RestoreOutcome {
  /**
   * @param {{ error: Error }} options
   */
  constructor({ error }) {
    super({ ok: false });
    this.error = error;
    Object.freeze(this);
  }
}
