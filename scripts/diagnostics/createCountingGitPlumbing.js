import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';

export async function createCountingGitPlumbing({ cwd, sessions = false }) {
  const plumbing = await createGitPlumbing({ cwd });
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
    counted.openCatFileSession = sessionOpener(plumbing, record, 'cat-file');
    counted.openMktreeSession = sessionOpener(plumbing, record, 'mktree');
    counted.openFastImportSession = sessionOpener(plumbing, record, 'fast-import');
  }

  return {
    plumbing: counted,
    snapshot: () => new Map(counts),
  };
}

function sessionOpener(plumbing, record, protocol) {
  const method =
    protocol === 'cat-file'
      ? 'openCatFileSession'
      : protocol === 'mktree'
        ? 'openMktreeSession'
        : 'openFastImportSession';
  return (...args) => {
    record(`session:${protocol}`);
    return plumbing[method](...args);
  };
}

function operationOf(args) {
  if (args[0] === 'cat-file' && args.some((arg) => arg.startsWith('--batch-check='))) {
    return 'cat-file:batch-check';
  }
  return args[0];
}
