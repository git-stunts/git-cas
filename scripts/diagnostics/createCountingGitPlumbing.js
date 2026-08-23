import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';

export async function createCountingGitPlumbing({ cwd, sessions = false }) {
  const plumbing = await createGitPlumbing({ cwd });
  const activeSessions = new Map();
  const counts = new Map();
  const record = (operation) => counts.set(operation, (counts.get(operation) ?? 0) + 1);
  const counted = {
    execute(options) {
      record(operationOf(options.args));
      return plumbing.execute(options);
    },
    executeStream(options) {
      record(operationOf(options.args));
      return plumbing.executeStream(options);
    },
  };

  if (sessions) {
    counted.openCatFileSession = sessionOpener({
      plumbing,
      record,
      activeSessions,
      protocol: 'cat-file',
    });
    counted.openMktreeSession = sessionOpener({
      plumbing,
      record,
      activeSessions,
      protocol: 'mktree',
    });
    counted.openFastImportSession = sessionOpener({
      plumbing,
      record,
      activeSessions,
      protocol: 'fast-import',
    });
  }

  return {
    activeSessions: () => new Map(activeSessions),
    plumbing: counted,
    snapshot: () => new Map(counts),
  };
}

function sessionOpener({ plumbing, record, activeSessions, protocol }) {
  const method =
    protocol === 'cat-file'
      ? 'openCatFileSession'
      : protocol === 'mktree'
        ? 'openMktreeSession'
        : 'openFastImportSession';
  return async (...args) => {
    record(`session:${protocol}`);
    const session = await plumbing[method](...args);
    activeSessions.set(protocol, (activeSessions.get(protocol) ?? 0) + 1);
    let released = false;
    const release = () => {
      if (released) {
        return;
      }
      released = true;
      const remaining = (activeSessions.get(protocol) ?? 1) - 1;
      if (remaining === 0) {
        activeSessions.delete(protocol);
      } else {
        activeSessions.set(protocol, remaining);
      }
    };
    return new Proxy(session, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') {
          return value;
        }
        if (!['abort', 'close', 'terminate'].includes(property)) {
          return value.bind(target);
        }
        return async (...methodArgs) => {
          const result = await value.apply(target, methodArgs);
          release();
          return result;
        };
      },
    });
  };
}

function operationOf(args) {
  if (args[0] === 'cat-file' && args.some((arg) => arg.startsWith('--batch-check='))) {
    return 'cat-file:batch-check';
  }
  return args[0];
}
