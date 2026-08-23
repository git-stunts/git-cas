import createCasError from '../../domain/errors/createCasError.js';
import { ErrorCodes } from '../../domain/errors/index.js';

const EXECUTE_DIRECTLY = (operation) => operation();

/**
 * Lazily owns one reusable typed update-ref process.
 *
 * A failed ref transaction is never replayed. Plumbing's typed session poisons
 * and terminates itself on protocol or Git failure; this owner only discards
 * the failed instance so a later, separately authorized mutation can open a
 * fresh process.
 */
export default class GitUpdateRefSessionPool {
  #active = new Set();
  #closed = false;
  #closePromise = null;
  #opening = null;
  #plumbing;

  constructor({ plumbing }) {
    this.#plumbing = plumbing;
  }

  supports() {
    return typeof this.#plumbing?.openUpdateRefSession === 'function';
  }

  async update(options, execute = EXECUTE_DIRECTLY) {
    this.#assertOpen();
    const operation = (async () => {
      let session;
      try {
        session = await this.#session();
        return await execute(() => session.update(options));
      } catch (error) {
        if (session !== undefined) {
          await this.#discard(session);
        }
        throw error;
      }
    })();
    this.#active.add(operation);
    try {
      return await operation;
    } finally {
      this.#active.delete(operation);
    }
  }

  async close() {
    if (this.#closePromise !== null) {
      return await this.#closePromise;
    }
    this.#closed = true;
    this.#closePromise = (async () => {
      await Promise.allSettled([...this.#active]);
      const opening = this.#opening;
      this.#opening = null;
      if (opening !== null) {
        const session = await opening;
        await session.close();
      }
    })();
    return await this.#closePromise;
  }

  async #discard(expectedSession) {
    const opening = this.#opening;
    if (opening === null) {
      return;
    }
    const session = await opening.catch(() => undefined);
    if (session === expectedSession && this.#opening === opening) {
      this.#opening = null;
    }
  }

  async #session() {
    this.#assertOpen();
    if (this.#opening === null) {
      const opening = Promise.resolve().then(() => this.#plumbing.openUpdateRefSession());
      this.#opening = opening;
      opening.catch(() => {
        if (this.#opening === opening) {
          this.#opening = null;
        }
      });
    }
    return await this.#opening;
  }

  #assertOpen() {
    if (this.#closed) {
      throw createCasError('Git ref session pool is closed', ErrorCodes.RESOURCE_CLOSED);
    }
  }
}
