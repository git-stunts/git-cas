import { vi } from 'vitest';
import { CasError, GitRefAdapter } from '../../index.js';

/** Injects around real adapter calls reached through the public facade. */
export default class NativeReservationPublicFault {
  #spy;
  #count = 0;

  constructor({ method, prefix, when }) {
    const original = GitRefAdapter.prototype[method];
    const hit = () => {
      this.#count++;
      throw new CasError('Injected public reservation ref fault', 'GIT_ERROR', { method, when });
    };
    this.#spy = vi.spyOn(GitRefAdapter.prototype, method).mockImplementation(async function (options) {
      const applies = options.ref.startsWith(prefix);
      if (applies && when === 'before') {
        hit();
      }
      const result = await original.call(this, options);
      if (applies && when === 'after') {
        hit();
      }
      return result;
    });
  }

  get count() { return this.#count; }
  restore() { this.#spy.mockRestore(); }
}
