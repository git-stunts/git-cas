import GitRefAdapter from '../../src/infrastructure/adapters/GitRefAdapter.js';
import { CasError, ErrorCodes } from '../../src/domain/errors/index.js';

/** Real native operations with a declared failure immediately before or after. */
export default class NativeReservationFaultRefs extends GitRefAdapter {
  #fault = null;
  #faultCount = 0;

  fail({ method, prefix, when }) {
    this.#fault = Object.freeze({ method, prefix, when });
  }

  clearFault() {
    this.#fault = null;
  }

  get faultCount() {
    return this.#faultCount;
  }

  async updateRef(options) {
    return await this.#mutate('updateRef', options, () => super.updateRef(options));
  }

  async deleteRef(options) {
    return await this.#mutate('deleteRef', options, () => super.deleteRef(options));
  }

  async #mutate(method, options, operation) {
    const applies = this.#fault?.method === method && options.ref.startsWith(this.#fault.prefix);
    if (applies && this.#fault.when === 'before') {
      this.#raise(method);
    }
    const result = await operation();
    if (applies && this.#fault.when === 'after') {
      this.#raise(method);
    }
    return result;
  }

  #raise(method) {
    this.#faultCount++;
    throw new CasError('Injected native reservation fault', ErrorCodes.GIT_ERROR, { method, when: this.#fault.when });
  }
}
