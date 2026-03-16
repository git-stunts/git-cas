# Test Conventions

Rules for writing deterministic, cross-runtime tests. All tests must pass
on Node.js, Bun, and Deno.

## Time and Scheduling

**Never assert wall-clock timing.** `Date.now()` deltas are
nondeterministic — they flake under CI load and vary across runtimes.

**Inject delay/timer dependencies.** If production code uses `setTimeout`
or similar scheduling, accept the delay function as a parameter:

```js
// production: injectable dependency with a real default
export function runAction(fn, getJson, { delay = defaultDelay } = {}) { ... }

// test: inject a spy — no global patching needed
const delaySpy = vi.fn().mockResolvedValue(undefined);
const action = runAction(fn, getJson, { delay: delaySpy });
await action();
expect(delaySpy).toHaveBeenCalledWith(1000);
```

**Avoid `vi.useFakeTimers()`.** Vitest fake timers rely on
`@sinonjs/fake-timers`, which patches globals differently across runtimes.
Prefer dependency injection over global monkey-patching.

## File Permissions

**Use `chmod()` after `writeFile()`, not `writeFile({ mode })`.** The
`mode` parameter is filtered through `process.umask()`. A restrictive
umask (e.g., `0o077`) silently strips the bits you requested, making
permission-sensitive tests environment-dependent.

```js
// wrong — umask can mask the requested mode
await writeFile(path, 'data', { mode: 0o644 });

// correct — chmod sets the exact mode regardless of umask
await writeFile(path, 'data');
await chmod(path, 0o644);
```

This applies to macOS and Linux (our supported platforms). Permission
bits are a Unix concept — `chmod` is a no-op on Windows.

## General Principles

- **Test behavior, not timing.** Assert that a function was called, not
  how long it took.
- **Inject infrastructure.** Clocks, filesystems, network — anything that
  varies across environments should be injectable through constructor
  parameters or function arguments.
- **No global state patching when injection is available.** If you control
  the code under test, add a parameter. Only patch globals for third-party
  code you cannot modify.

## Git Tree Assertions

**Git tree reads are filename-sorted.** Git returns tree entries in name
order, not in the original write order. Integration tests that round-trip
through `readTree()` must therefore assert membership, uniqueness, and Git's
sorted output semantics instead of assuming first-seen insertion order.

If insertion order matters, assert it at the lower-level boundary that builds
the tree entries before they are handed to Git.

## Integration Runtime Policy

**Integration suites are Docker-only.** The integration tests intentionally
refuse to run on the host and require `GIT_STUNTS_DOCKER=1` so Git, Bun, and
Deno run in a consistent environment.

**Integration files run with `fileParallelism: false`.** These tests spawn real
Git and CLI subprocesses, so the integration workspace is intentionally kept to
single-file execution. Do not re-enable file-level parallelism unless the
subprocess model changes and Bun/Deno are re-validated.

## Subprocess Helpers

**Use direct argv execution, never shell-wrapped commands.** CLI and Git
integration helpers must call `spawnSync()` / `spawn()` with an explicit binary
and argv array. Avoid `/bin/sh -c`, command-string helpers, or concatenated
shell fragments because they introduce quoting drift and runtime-specific I/O
differences.

```js
// preferred
spawnSync('git', ['init', '--bare'], { cwd, encoding: 'utf8' });

// avoid
spawnSync('/bin/sh', ['-c', 'git init --bare'], { cwd, encoding: 'utf8' });
```
