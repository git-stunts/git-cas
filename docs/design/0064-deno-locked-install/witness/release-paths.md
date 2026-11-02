# Explicit Deno release paths

Independent review identified release commands that still omitted the explicit
manual node_modules mode used by the repaired CI image. Deno can default to that
mode when package.json is present; this finding does not establish that the
unflagged form selected another graph. It identifies an inconsistent invocation
contract and a release path not represented by the flagged runtime evidence.

The release runner, hosted release integration command and both operator
commands now pass `--node-modules-dir=manual`. An execution-level release-runner
test captures the actual step handed to its injected runner. On the prior code,
`deno-release-red-01` passes 15 existing cases and fails that new assertion because
the mode flag is missing. This is an expected assertion failure, not setup failure.

The corrected `deno-release-green-01` phase passes the full Node unit suite:
2,224 passed with three existing conditional skips, plus lint. It extracts the
Deno arguments from the actual RELEASE_STEPS definition and runs them inside the
existing guarded worker, appending only the two-worker execution cap. Deno passes
2,215 unit cases with 12 existing conditional skips. The corresponding flagged
Deno integration command passes all 219 cases.

[Exact copied snapshots and raw evidence hashes](release-paths.json) preserve
both phases. The change introduces no dependency, graph-format or application
API behavior. The publication workflow itself was not run; current-head hosted
CI and independent approval remain gates. Normal hooks are never bypassed;
this checkout has no active custom hook configuration, so no hook execution is
claimed. Resource limits and cleanup match the original install witness.
