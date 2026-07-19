import {
  GitObjectMissingError,
  GitProtocolError,
  InvalidArgumentError,
} from '@git-stunts/plumbing';

const PROTOCOLS = Object.freeze({
  catFile: Object.freeze({ opener: 'openCatFileSession', abort: 'terminate' }),
  fastImport: Object.freeze({ opener: 'openFastImportSession', abort: 'abort' }),
  mktree: Object.freeze({ opener: 'openMktreeSession', abort: 'terminate' }),
});
const EXECUTE_DIRECTLY = (operation) => operation();

/**
 * Lazily owns one typed plumbing session per Git object protocol.
 */
export default class GitObjectSessionPool {
  #active = new Map();
  #closePromise = null;
  #closed = false;
  #idleFailures = new Map();
  #idleTimeoutMs;
  #idleTimers = new Map();
  #plumbing;
  #retirements = new Map();
  #sessions = new Map();

  constructor({ plumbing, idleTimeoutMs }) {
    this.#plumbing = plumbing;
    this.#idleTimeoutMs = idleTimeoutMs;
  }

  supports(protocol) {
    const descriptor = PROTOCOLS[protocol];
    return descriptor !== undefined && typeof this.#plumbing[descriptor.opener] === 'function';
  }

  async info(objectName, execute = EXECUTE_DIRECTLY) {
    return await this.#run(
      'catFile',
      (session) => execute(() => session.info(objectName)),
      isRecoverableCatError
    );
  }

  async read(objectName, options, execute = EXECUTE_DIRECTLY) {
    return await this.#run(
      'catFile',
      (session) => execute(() => session.read(objectName, options)),
      isRecoverableCatError
    );
  }

  async writeBlobs(contents, execute = EXECUTE_DIRECTLY) {
    return await this.#run('fastImport', (session) =>
      execute(async () => {
        const oids = [];
        for (const content of contents) {
          oids.push(await session.writeBlob(content));
        }
        await session.checkpoint();
        return Object.freeze(oids);
      })
    );
  }

  async writeTree(entries, execute = EXECUTE_DIRECTLY) {
    return await this.#run('mktree', (session) => execute(() => session.write(entries)));
  }

  async invalidate(protocol, expectedSession) {
    this.#cancelIdle(protocol);
    const opening = this.#sessions.get(protocol);
    if (expectedSession !== undefined) {
      if (opening !== undefined) {
        const current = await opening.catch(() => undefined);
        if (current === expectedSession && this.#sessions.get(protocol) === opening) {
          this.#sessions.delete(protocol);
        }
      }
      await this.#trackRetirement(protocol, () => this.#abort(protocol, expectedSession));
      return;
    }
    this.#sessions.delete(protocol);
    if (opening === undefined) {
      const retirement = this.#retirements.get(protocol);
      if (retirement !== undefined) {
        await retirement.completion;
      }
      return;
    }
    await this.#trackRetirement(protocol, async () => {
      const session = await opening.catch(() => undefined);
      if (session !== undefined) {
        await this.#abort(protocol, session);
      }
    });
  }

  async retire(protocol) {
    this.#cancelIdle(protocol);
    const opening = this.#sessions.get(protocol);
    this.#sessions.delete(protocol);
    if (opening === undefined) {
      const retirement = this.#retirements.get(protocol);
      if (retirement !== undefined) {
        await retirement.completion;
      }
      return;
    }
    await this.#trackRetirement(protocol, async () => {
      const session = await opening.catch(() => undefined);
      if (session !== undefined) {
        await this.#closeSession(protocol, session, `Git ${protocol} session failed to retire`);
      }
    });
  }

  async close() {
    if (this.#closePromise !== null) {
      return await this.#closePromise;
    }
    this.#closed = true;
    for (const protocol of this.#idleTimers.keys()) {
      this.#cancelIdle(protocol);
    }
    const sessions = [...this.#sessions.entries()];
    const retirements = [...this.#retirements.values()].map((retirement) => retirement.barrier);
    this.#sessions.clear();
    this.#closePromise = (async () => {
      const results = await Promise.allSettled(
        sessions.map(async ([protocol, opening]) => {
          const session = await opening;
          await this.#closeSession(
            protocol,
            session,
            `Git ${protocol} session failed to close or terminate`
          );
        })
      );
      await Promise.allSettled(retirements);
      const failures = results
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason);
      failures.push(...this.#idleFailures.values());
      if (failures.length > 0) {
        throw new AggregateError(failures, 'One or more Git object sessions failed to close');
      }
    })();
    return await this.#closePromise;
  }

  async #run(protocol, operation, recoverable = () => false) {
    this.#cancelIdle(protocol);
    this.#active.set(protocol, (this.#active.get(protocol) ?? 0) + 1);
    try {
      return await this.#attempt({ protocol, operation, recoverable, mayRetry: true });
    } finally {
      this.#release(protocol);
    }
  }

  async #attempt({ protocol, operation, recoverable, mayRetry }) {
    let session;
    try {
      session = await this.#session(protocol);
      return await operation(session);
    } catch (error) {
      if (recoverable(error) || error instanceof InvalidArgumentError) {
        throw error;
      }
      try {
        await this.invalidate(protocol, session);
      } catch (invalidationError) {
        throw new AggregateError(
          [error, invalidationError],
          `Git ${protocol} operation and session invalidation both failed`
        );
      }
      if (mayRetry && error instanceof GitProtocolError) {
        return await this.#attempt({ protocol, operation, recoverable, mayRetry: false });
      }
      throw error;
    }
  }

  #release(protocol) {
    const remaining = (this.#active.get(protocol) ?? 1) - 1;
    if (remaining === 0) {
      this.#active.delete(protocol);
      this.#scheduleIdle(protocol);
      return;
    }
    this.#active.set(protocol, remaining);
  }

  async #session(protocol) {
    if (this.#closed) {
      throw new Error('Git object session pool is closed');
    }
    const descriptor = PROTOCOLS[protocol];
    if (descriptor === undefined || typeof this.#plumbing[descriptor.opener] !== 'function') {
      throw new Error(`Git object protocol is unavailable: ${protocol}`);
    }
    let opening = this.#sessions.get(protocol);
    if (opening === undefined) {
      let retirement = this.#retirements.get(protocol);
      while (retirement !== undefined) {
        await retirement.barrier;
        const latest = this.#retirements.get(protocol);
        if (latest === retirement) {
          break;
        }
        retirement = latest;
      }
      if (this.#closed) {
        throw new Error('Git object session pool is closed');
      }
      opening = this.#sessions.get(protocol);
    }
    if (opening === undefined) {
      opening = Promise.resolve().then(() => this.#plumbing[descriptor.opener]());
      this.#sessions.set(protocol, opening);
      opening.catch(() => {
        if (this.#sessions.get(protocol) === opening) {
          this.#sessions.delete(protocol);
        }
      });
    }
    return await opening;
  }

  async #abort(protocol, session) {
    const method = PROTOCOLS[protocol]?.abort;
    if (method !== undefined && typeof session[method] === 'function') {
      await session[method]();
    }
  }

  async #closeSession(protocol, session, message) {
    try {
      await session.close();
    } catch (closeError) {
      try {
        await this.#abort(protocol, session);
      } catch (abortError) {
        throw new AggregateError([closeError, abortError], message);
      }
      throw closeError;
    }
  }

  #scheduleIdle(protocol) {
    if (this.#closed || this.#active.has(protocol) || !this.#sessions.has(protocol)) {
      return;
    }
    const opening = this.#sessions.get(protocol);
    const timer = setTimeout(() => {
      this.#idleTimers.delete(protocol);
      if (this.#active.has(protocol) || this.#sessions.get(protocol) !== opening) {
        return;
      }
      this.#sessions.delete(protocol);
      this.#trackIdleRetirement(protocol, opening);
    }, this.#idleTimeoutMs);
    timer.unref?.();
    this.#idleTimers.set(protocol, timer);
  }

  #trackIdleRetirement(protocol, opening) {
    this.#trackRetirement(
      protocol,
      async () => {
        const session = await opening;
        await this.#closeSession(
          protocol,
          session,
          `Idle Git ${protocol} session failed to close or terminate`
        );
      },
      true
    );
  }

  #trackRetirement(protocol, operation, recordFailure = false) {
    const previous = this.#retirements.get(protocol)?.barrier ?? Promise.resolve();
    const completion = previous.then(operation);
    const barrier = completion.catch((error) => {
      if (recordFailure) {
        this.#idleFailures.set(protocol, error);
      }
    });
    const retirement = { barrier, completion };
    this.#retirements.set(protocol, retirement);
    void barrier.finally(() => {
      if (this.#retirements.get(protocol) === retirement) {
        this.#retirements.delete(protocol);
      }
    });
    return completion;
  }

  #cancelIdle(protocol) {
    const timer = this.#idleTimers.get(protocol);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#idleTimers.delete(protocol);
    }
  }
}

function isRecoverableCatError(error) {
  return (
    error instanceof GitObjectMissingError ||
    error?.details?.code === 'OBJECT_BUFFER_LIMIT_EXCEEDED'
  );
}
