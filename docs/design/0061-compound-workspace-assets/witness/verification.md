# Compound Workspace Assets Verification

## Exact implementation

- implementation commit: `e663754bf221784f0e5856a41fe071bebfa5befb`
- implementation PR: [#128](https://github.com/git-stunts/git-cas/pull/128)
- base commit: `6d5a43e2853f61b3c12d5000e81ef7832c00b8d2`
- installed Plumbing: `@git-stunts/plumbing@3.3.0`
- Node.js: `v26.0.0`
- Git: `2.50.1 (Apple Git-155)`
- host: macOS arm64
- structured witness:
  [`compound-workspace-assets.json`](./compound-workspace-assets.json)

The implementation worktree was clean when the complete release verifier
started and after it completed. The verifier's build stamp named the same
implementation commit.

## Red to green

The first focused run against the v6.5.9 surface produced ten expected
failures. They proved that compound admission lacked an asset capability, the
asset service could not join a caller-owned persistence scope, exact selected
roots and adversarial selector laws were absent, and the public declarations
did not expose the new contract.

The final focused contract passed 46/46 tests. It covers:

- asset batches sharing the caller-owned persistence scope without nesting;
- invocation-ordered asset, page, and bundle waves;
- retain-all compatibility and exact selected-root retention;
- stable canonical deduplication and prior-root preservation;
- non-function, non-array, asynchronous, empty, oversized, malformed,
  lookalike, and valid-but-unstaged selector refusal before ref movement;
- asset failure containment and public TypeScript declarations.

## Complete release method

```bash
pnpm run release:verify
```

| Gate                      | Result | Observed tests |
| ------------------------- | ------ | -------------: |
| Lint                      | PASS   |              - |
| Unit tests (Node)         | PASS   |          2,192 |
| Unit tests (Bun)          | PASS   |          2,191 |
| Unit tests (Deno)         | PASS   |          2,182 |
| Public type compatibility | PASS   |              - |
| Integration tests (Node)  | PASS   |            207 |
| Integration tests (Bun)   | PASS   |            207 |
| Integration tests (Deno)  | PASS   |            207 |
| Examples                  | PASS   |              - |
| Build metadata stamp      | PASS   |              - |
| npm pack dry-run          | PASS   |              - |
| JSR publish dry-run       | PASS   |              - |
| **Method summary**        | 14/14  |      **7,186** |

Runtime-defined skips account for the different unit totals. No failing test
or incomplete verifier stage was omitted from the summary.

## Real Git safety proof

The integration suite runs the compound graph against fresh SHA-1 and SHA-256
repositories. Each object format proves:

- one checked workspace ref update and one scoped fast-import session;
- no active fast-import session after the outer operation settles;
- one selected direct terminal root rather than every construction
  intermediate;
- transitive asset and page readback after `git prune --expire=now`;
- graph reclamation after workspace release, reflog expiry, and immediate Git
  garbage collection;
- failure containment without a partial generation.

The selector does not turn physical batching into a cross-ref transaction.
Immutable objects written before refusal can remain unreachable until normal
Git maintenance reclaims them.

## Downstream controlled prototype

git-warp PR [#852](https://github.com/git-stunts/git-warp/pull/852) exercised a
65-node/65-patch corpus plus a five-patch suffix. Each scenario used one warmup
and three measured runs. The control used public git-cas v6.5.9; the optimized
run used the exact API implemented here through a local prototype.

| Scenario    | Git commands | Median CPU ms | Median wall ms |
| ----------- | -----------: | ------------: | -------------: |
| Cold before |          139 |       545.476 |       2,822.893 |
| Cold after  |           50 |       322.103 |       1,328.603 |
| Incr before |          149 |       555.478 |       3,039.536 |
| Incr after  |           60 |       320.050 |       1,387.245 |
| Warm before |           25 |       166.882 |         548.191 |
| Warm after  |           25 |       176.325 |         622.956 |

The cold path used 64.029% fewer Git commands, 40.950% less Node CPU, and
52.935% less wall time. The incremental path used 59.732% fewer Git commands,
42.383% less Node CPU, and 54.360% less wall time. The warm path performs no
materialization write and retained the exact 25-command topology; its elapsed
variation is host noise, not a claimed regression or improvement.

Semantic fingerprints, node/edge/property counts, cache posture, and replay
counts were equal between control and prototype: 65 cold patches, five
incremental patches, and zero warm patches. These measurements justify the API
but are not yet registry-artifact evidence. They must be rerun after v6.5.10 is
publicly installable.

## Compatibility boundary

This implementation is additive and migration-free. It changes no stored
asset, page, bundle, descriptor, RootSet, handle, namespace, ref layout, or
reader. Omitting `retain` preserves v6.5.9 retain-all behavior. Existing
repositories and active workspace refs open in place without rewriting or an
authority cutover.

## Publication boundary

The implementation is not a published v6.5.10 release merely because this
witness and local verification are green. Publication still requires hosted
review and CI on the exact PR head, a normal reviewed merge, a separately
reviewed versioned release candidate, a signed annotated tag that peels to the
reviewed release merge, successful registry publication, and an external
consumer installation check.
