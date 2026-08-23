---
title: 'PERF-0058 - Bounded Stream Session Reads'
cycle: '0058'
task_id: 'bounded-stream-session-reads'
legend: 'PERF'
release_home: 'v6.5.7'
issue: 'https://github.com/git-stunts/git-cas/issues/115'
goalpost_issue: 'https://github.com/git-stunts/git-cas/issues/115'
tracker_source: 'github'
status: 'active'
base_commit: '00661b07271d8ca7166c0b62beeb1408d72a3706'
owners:
  - '@git-stunts'
sponsors:
  human: 'James'
  agent: 'Codex'
blocking_issues: []
supersedes: []
superseded_by: null
created: '2026-08-23'
updated: '2026-08-23'
---

# PERF-0058 - Bounded Stream Session Reads

## Linked Issue

- [#115 - Reuse bounded Git sessions for small streaming reads](https://github.com/git-stunts/git-cas/issues/115)

## Linked Tracker

- Milestone: [`v6.5.7`](https://github.com/git-stunts/git-cas/milestone/17)
- Goalpost issue: [#115](https://github.com/git-stunts/git-cas/issues/115)
- Downstream consumer checkpoint:
  [`git-warp#847`](https://github.com/git-stunts/git-warp/pull/847)

## Design Type

This design is primarily:

- [x] Runtime/API
- [x] Storage/substrate
- [x] Migration/release
- [ ] CLI/operator
- [x] Docs/public guidance
- [ ] TUI/visual surface
- [x] Test/tooling

## Decision Summary

`GitPersistenceAdapter.readBlobStream()` will reuse the existing typed
`cat-file --batch-command` session when immutable object metadata proves that
the target is a blob no larger than 10 MiB. The adapter reads that object under
the same fixed 10 MiB budget and returns it as one `Buffer` chunk. Objects above
that ceiling, exceptional metadata states, and plumbing implementations without
typed sessions retain the existing one-shot streaming path. The public method,
bytes, object identities, storage formats, refs, and retention behavior do not
change.

## Sponsored Human

An application operator wants git-warp and Think to read thousands of small
patch payloads without launching one Git child for every payload, while large
assets remain genuinely streamed and memory cannot silently become unbounded.

## Sponsored Agent

An agent needs process topology, byte equality, the buffer ceiling, fallback
selection, and resource closure to be inspectable through deterministic tests
and a machine-readable witness, without inferring performance from wall-clock
noise.

## Hill

By the end of this cycle, repeated small `readBlobStream()` calls through one
session-capable adapter open one persistent `cat-file` child and zero one-shot
`cat-file` children. A blob larger than 10 MiB still opens the genuine streaming
path directly. Unit and real-Git tests prove both routes, byte equality, and
deterministic closure before `v6.5.7` is published.

## Current Truth

- `readBlob()` uses `GitObjectSessionPool.read()` when the injected plumbing
  exposes `openCatFileSession()`.
  [cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#185-223@00661b07271d8ca7166c0b62beeb1408d72a3706`]
- `readBlobStream()` always opens one
  `executeStream({ args: ['cat-file', 'blob', oid] })` operation, even when a
  typed session is available.
  [cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#238-245@00661b07271d8ca7166c0b62beeb1408d72a3706`]
- The session pool already supplies bounded `info()` and `read()` operations,
  serializes calls, retries one typed protocol failure, preserves alignment
  after missing/oversized responses, idles out, and closes deterministically.
  [cite: `src/infrastructure/adapters/GitObjectSessionPool.js#1-333@00661b07271d8ca7166c0b62beeb1408d72a3706`]
- `ChunkRepository.readChunkBlob()` consumes `readBlobStream()` and collects one
  verified chunk before exposing it to restore callers. git-warp patch reads
  therefore already materialize each small patch payload at the consumer
  boundary.
  [cite: `src/domain/services/ChunkRepository.js#127-157@00661b07271d8ca7166c0b62beeb1408d72a3706`]
- A fresh v6.5.6 census observed one persistent child for 12 repeated
  `readBlob()` calls but 12 one-shot children for 12 repeated
  `readBlobStream()` calls.
- Downstream `git-warp#847` reduced one measured run from 82.9 seconds and
  3,505 Git children to 8.9 seconds and 1,792 children for roughly 1,745 patch
  payloads after batching metadata. The remaining count is consistent with one
  payload-stream child per patch, but this design does not treat that
  correlation as independent proof.
- PERF-0052 deliberately kept every payload on the one-shot stream because it
  had no evidenced small-payload exception. This design narrowly supersedes
  that decision for blobs at or below the explicit 10 MiB ceiling; its
  large-payload invariant remains authoritative.

## Problem

The stream-native port correctly prevents arbitrary payloads from being
materialized at the adapter boundary, but it also forces process-per-object
execution for payloads that are already bounded and fully collected by the
consumer. In Think's patch path, Git process startup therefore scales with
patch count even after git-warp removes redundant metadata commands. Fixing
that in git-warp would duplicate git-cas persistence policy and expose Git
protocol ownership to the wrong layer.

## Scope

This cycle includes:

- a fixed 10 MiB ceiling for the session-buffered stream route;
- immutable type and size inspection through the existing bounded metadata
  path;
- one complete typed-session read only after metadata proves the blob is
  within the ceiling;
- direct one-shot streaming for larger objects, without a speculative content
  read;
- legacy one-shot fallback when typed sessions are unavailable;
- exceptional-state fallback to the existing one-shot stream contract;
- deterministic unit and real-Git process-topology tests;
- active-session lifecycle instrumentation in the diagnostic counting helper;
- a committed JSON witness and `v6.5.7` release evidence;
- downstream publication ordering: git-cas, then git-warp, then Think.

## Non-Goals

This cycle does not include:

- changing the `readBlobStream()` signature or persistence port;
- buffering objects larger than 10 MiB;
- making `maxBlobSize` an unbounded stream-allocation authority;
- changing object, manifest, ref, retention, or witness formats;
- adding a streaming protocol to `@git-stunts/plumbing`;
- caching application payload bytes across calls;
- changing `ChunkRepository`, git-warp, or Think in this repository;
- claiming graph-wide memory bounds, zero Git processes, or a wall-clock
  guarantee from a small fixture.

## Runtime / API Contract

The public contract remains:

```ts
readBlobStream(oid: string): Promise<AsyncIterable<Buffer>>;
```

For plumbing with `openCatFileSession()`:

1. Inspect immutable object metadata through the existing session/cache path.
2. If metadata identifies a blob with `size <= 10 * 1024 * 1024`, issue one
   session `read()` with `maxBytes` fixed to that same ceiling and return its
   content as one `Buffer` chunk.
3. If the object is larger, not a blob, missing, invalid, or metadata inspection
   fails, use the existing one-shot stream path.
4. If a bounded session content read fails before bytes are returned, retire or
   recover the session through existing pool policy and fall back to the
   one-shot stream path.

For plumbing without `openCatFileSession()`, behavior is exactly the existing
one-shot path.

The metadata check always precedes a bounded content read. An oversized object
is never first requested through `session.read()` and therefore is not read or
discarded twice.

## User Experience / Product Shape

There is no new CLI, TUI, or public method. The user-visible outcome is lower
latency and fewer child processes for consumers that read many small blobs
through the existing API. The exact topology is visible through tests and the
JSON witness rather than new terminal prose.

## Data / State Model

| State              | Source of truth            | Derived state                | Invalid states                        | Reset behavior                                       | Serialization | Determinism assumptions                            |
| ------------------ | -------------------------- | ---------------------------- | ------------------------------------- | ---------------------------------------------------- | ------------- | -------------------------------------------------- |
| Blob type and size | Immutable Git object       | Bounded metadata cache entry | Missing or malformed response         | Reject metadata optimization and use existing stream | Git protocol  | One OID identifies immutable type, size, and bytes |
| Small blob bytes   | Git object database        | One returned `Buffer` chunk  | Type mismatch or content read failure | Fall back before yielding bytes                      | Git protocol  | Session and one-shot paths return identical bytes  |
| Session lifecycle  | Adapter-owned process pool | Active/idle diagnostic count | Closed or poisoned session reused     | Existing invalidation, retry, idle, and close rules  | None          | One live session per supported protocol            |

## Architecture / Anti-SLUDGE Posture

| Concern                         | Decision                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| Domain changes                  | None; domain services retain the existing stream port.                                   |
| Port changes                    | None; no signature or capability is added.                                               |
| Adapter changes                 | Routing and bounded read reuse stay in `GitPersistenceAdapter`.                          |
| Boundary validation             | Object metadata selects the route before content is read.                                |
| Runtime-backed nouns introduced | None; the existing session pool owns Git children.                                       |
| Expected failure representation | Existing one-shot behavior remains the exceptional fallback.                             |
| Banned shortcuts avoided        | No consumer cache, arbitrary buffering, speculative oversized read, or timing assertion. |

## Cost / Residency Posture

| Surface                     | Current cost                        | Target cost                              | Limit/budget                      | Failure mode                                 |
| --------------------------- | ----------------------------------- | ---------------------------------------- | --------------------------------- | -------------------------------------------- |
| Repeated small stream reads | One Git child per blob              | One serialized session child per adapter | 10 MiB per admitted read          | Fall back to one-shot stream before yielding |
| Oversized stream read       | One genuine streaming child         | Unchanged, plus bounded metadata lookup  | Content is never session-buffered | Existing stream behavior                     |
| Metadata                    | Bounded session/cache               | Reused for route selection               | Existing count-bounded cache      | Existing normalization or stream fallback    |
| Adapter lifetime            | Explicit close plus idle retirement | Unchanged                                | One session per protocol          | Aggregate close failure remains visible      |

The fixed 10 MiB ceiling is not raised by `setMaxBlobSize()`. Concurrent callers
can still retain multiple returned chunks, just as concurrent `readBlob()`
callers can retain multiple bounded results; this cycle makes no aggregate
caller-residency claim. The adapter itself does not cache returned payloads.

## Determinism / Replay / Causality

Process topology changes; object bytes, hashes, handles, manifests, ordering,
refs, and retention do not. The witness compares semantic digests between
one-shot and session paths and treats command counts—not elapsed time—as the
deterministic acceptance evidence.

## Git Substrate Impact

| Substrate area          | Impact                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------- |
| refs                    | None                                                                                   |
| commits                 | None                                                                                   |
| trees/blobs             | Small existing blobs may be read through `cat-file --batch-command`; no writes change. |
| object ids              | Unchanged and verified by byte equality.                                               |
| tag/release behavior    | A new signed `v6.5.7` tag is required after merged-main verification.                  |
| migration compatibility | No repository or data migration.                                                       |

## Compatibility / Migration Posture

| Concern                    | Decision                                                                |
| -------------------------- | ----------------------------------------------------------------------- |
| Public API compatibility   | Exact existing signature and return type.                               |
| Package export changes     | None.                                                                   |
| Storage/read compatibility | Same objects and byte sequence.                                         |
| Legacy behavior retained   | No-session, oversized, and exceptional states use the existing stream.  |
| Deprecation behavior       | None.                                                                   |
| Migration path             | None required.                                                          |
| Release note impact        | Record the process-topology performance correction and its fixed bound. |

## Error Contract

| Failure                                 | Error/result                                   | Caller recovery            | Test                                             |
| --------------------------------------- | ---------------------------------------------- | -------------------------- | ------------------------------------------------ |
| Metadata says object is oversized       | Existing one-shot stream                       | Consume or cancel normally | Unit and real-Git oversized tests                |
| Metadata says non-blob or missing       | Existing one-shot behavior                     | Existing caller handling   | Unit exceptional-route tests                     |
| Session content read fails before yield | Existing pool recovery, then one-shot fallback | Existing caller handling   | Unit fallback test                               |
| One-shot stream fails                   | Existing plumbing/stream result                | Existing caller handling   | Existing stream tests                            |
| Adapter closes                          | Existing deterministic close behavior          | Open a new adapter         | Unit lifecycle plus real-Git active-session test |

## Security / Trust / Redaction Posture

- trust boundary: repository-controlled object metadata and bytes remain
  untrusted inputs;
- authority or capability checked: only feature detection of the injected
  typed-session method;
- secret-bearing values: none are added to reports;
- redaction behavior: witness records counts, sizes, digests, and versions, not
  payload content or repository paths;
- log/report behavior: no Git stderr or payload bytes are committed;
- abuse or replay concern: a repository cannot raise the fixed 10 MiB buffer
  ceiling through metadata or runtime configuration.

## Lower Modes

There is no rendered UI. The machine-readable witness is the lower mode and
contains the same semantic equality, count, routing, and close facts as the
human-readable design and verification record.

## Accessibility Posture

The design, changelog, and witness verification use a linear text model and do
not rely on color, layout, animation, or screenshots. Structured JSON carries
the equivalent evidence for assistive tools and agents.

## User-Facing Text / Directionality

Only English left-to-right documentation and release notes change. No runtime
messages or directional UI assumptions are added.

## Agent Inspectability / Explainability Posture

An agent can inspect exact `session:cat-file` and one-shot `cat-file` counts,
semantic digests, admitted/oversized byte sizes, and active-session counts
before and after close. It does not need to scrape process listings, time a
fixture, or infer route selection from private implementation text.

## Linked Invariants

- immutable Git OIDs identify stable type, size, and content;
- application payloads are never cached by the adapter;
- no object above 10 MiB enters the session-buffered stream route;
- oversized content enters its stream directly, without a discarded first
  content read;
- fallback capability and exceptional behavior remain available;
- one adapter owns and deterministically closes its protocol sessions;
- GitHub owns active status; committed docs and witnesses own design/evidence;
- publication proceeds git-cas, then git-warp, then Think.

## Design Alternatives Considered

### Keep every stream one-shot

Preserves the old abstraction literally, but retains one process launch per
small payload and leaves the diagnosed consumer bottleneck intact.

### Buffer every streamed blob through the session

Would maximize process reuse but violate the large-object streaming invariant
and permit repository-controlled whole-object allocation.

### Attempt a bounded session read and stream after overflow

The typed session can drain an oversized response safely, but the subsequent
one-shot route would read the same large object again. Reject this because
metadata can select the route without duplicate content I/O.

### Add a streaming cat-file session to plumbing

Could preserve chunk-level backpressure inside one process, but requires new
wire-protocol multiplexing, cancellation, and alignment ownership plus a
separate plumbing release. It is unnecessary for the already-collected small
patch payloads and outside this release boundary.

### Cache patch payloads in git-warp or Think

Would duplicate persistence policy in consumers, retain application bytes
without a shared eviction contract, and leave every other git-cas consumer on
the process-per-stream path.

## Decision

Adopt metadata-first routing with a fixed 10 MiB session-read ceiling. Reuse
the existing persistent session for admitted blobs, return one `Buffer` chunk,
and preserve the existing one-shot stream for oversized, unsupported, or
exceptional paths. This is the narrowest correction that removes per-patch
startup without weakening large-object safety or widening the public API.

## Proof Surface

The implementation must be proven through:

- actual surface under test: `GitPersistenceAdapter.readBlobStream()`;
- first RED test: a small stream must call one typed `info()`/`read()` session
  and zero `executeStream()` operations;
- real-Git law: repeated small reads open one `session:cat-file` child and zero
  one-shot `cat-file` children;
- oversized law: metadata inspection opens the session, content uses exactly
  one one-shot stream, and session `read()` is never invoked;
- required witness command:
  `node scripts/diagnostics/measure-bounded-stream-session-reads.js`;
- non-acceptable proof: wall-clock-only comparisons, mocks without real Git,
  source-text assertions, or downstream timing without a git-cas process
  census.

## Implementation Slices

1. Design and RED unit/real-Git topology tests.
2. Narrow adapter routing and shared bounded session-read helper.
3. Counting-helper lifecycle instrumentation and focused diagnostic.
4. Committed witness, changelog, planning truth, and full validation.
5. Implementation PR, merged-main release verification, release PR, signed tag,
   and publication verification.

## Tests To Write First

- [x] A small session-capable stream yields exact bytes through one bounded
      session read and never invokes `executeStream()`.
- [x] An object above 10 MiB performs metadata inspection but never invokes the
      session content read; its bytes come from exactly one streamed command.
- [x] Raising `maxBlobSize` cannot raise the fixed stream-session ceiling.
- [x] Missing, non-blob, invalid, and failed-session metadata retain the
      existing one-shot route.
- [x] Plumbing without session support retains the existing stream behavior.
- [x] Repeated real-Git small reads produce one persistent child and zero
      one-shot children with identical bytes.
- [x] Real-Git oversized content produces one metadata session and one one-shot
      stream with identical bytes.
- [x] Explicit close reduces the diagnostic active-session count to zero.

## Acceptance Criteria

The work is done when:

- [x] Every required test above is GREEN and calibrated RED against v6.5.6.
- [x] Small repeated reads prove constant session-process startup.
- [x] Large payloads never enter the session content-read path.
- [x] Bytes, OIDs, public signatures, storage, refs, and retention are
      unchanged.
- [x] The fixed ceiling and nonclaims are documented consistently.
- [x] Node, Bun, Deno, lint, package, JSR, and release gates pass.
- [ ] The committed witness is linked from the reviewed PR.
- [ ] The implementation and release PRs merge normally.
- [ ] Signed tag, npm package/provenance, workflow, and GitHub Release are
      independently verified.

## Validation Plan

During implementation:

```bash
npx vitest run test/unit/infrastructure/adapters/GitPersistenceAdapter.sessions.test.js
GIT_STUNTS_DOCKER=1 npx vitest run test/integration/bundle-reference-performance.test.js --no-file-parallelism
npm run test:integration:node -- --run test/integration/bundle-reference-performance.test.js
npx eslint .
npm test
node scripts/diagnostics/measure-bounded-stream-session-reads.js
npm run release:verify
git diff --check
```

The host integration command is shown only as the test's fail-closed contract;
the authoritative real-Git run is through Docker.

## Playback / Witness

- [Machine-readable process-topology witness](./witness/bounded-stream-session-reads.json)
- [Human-readable verification record](./witness/verification.md)

The witness packet answers:

- Are fallback and session bytes semantically identical?
- How many children does each small-read path open?
- Does the oversized path avoid a session content read?
- Is the 10 MiB ceiling explicit in the report?
- Are all sessions inactive after adapter close?
- Which Git, Node, platform, and exact commit produced the evidence?

## Risks

- Ten MiB is bounded but not tiny. Concurrent callers may retain multiple
  returned chunks; the design makes no aggregate caller-residency claim.
- Returning one chunk changes backpressure granularity for admitted objects.
  The bound and downstream full-collection behavior make that trade explicit.
- Metadata inspection adds one session request for a cold oversized read. The
  content itself remains single-pass and genuinely streamed.
- Falling back after a session read failure may add recovery work before the
  legacy command, but prevents the optimization from becoming a new
  availability dependency.
- Timing can vary across machines. Process topology and semantic equality are
  the acceptance evidence; timing is diagnostic only.

## Follow-On Debt

`git-warp#847` owns the downstream metadata batching and consumer benchmark.
After `v6.5.7` is independently published, git-warp must consume it, rerun its
process census, and publish its own release before Think upgrades. Any demand
for persistent truly streaming `cat-file` multiplexing becomes a separate
plumbing/git-cas issue rather than expanding this cycle.

## Tracker Disposition

| Issue                                            | Role                | Expected disposition                                          |
| ------------------------------------------------ | ------------------- | ------------------------------------------------------------- |
| https://github.com/git-stunts/git-cas/issues/115 | Primary goalpost    | Close only after v6.5.7 publication is independently verified |
| https://github.com/git-stunts/git-warp/pull/847  | Downstream consumer | Leave untouched until git-cas v6.5.7 is live                  |

## Done Does Not Mean

When this lands, it does not prove:

- all git-warp or Think performance work is complete;
- all Git subprocesses are eliminated;
- arbitrary payloads are buffered or fit in memory;
- aggregate concurrent caller residency is bounded to 10 MiB;
- a small-fixture wall-clock result generalizes to every repository;
- git-warp or Think may publish before independently consuming this release.

## Retrospective

Implementation checkpoint before review:

- RED specification commit:
  `f35775f7b8aac0f613cc76bf6bb482815f0ed934`
- bounded-session implementation commit:
  `135a8ff416b12e6abede0b0f78a3e6ba00ca1255`
- the deterministic witness proves 32 small fallback reads open 32 one-shot
  children while the session route opens one persistent child, returns the
  same semantic digest, and closes cleanly;
- the 10 MiB + 1 byte witness opens one metadata session and one genuine
  content stream, with no session content read;
- the implementation tree passed all 14 release-verification gates with 6,919
  observed tests before publication work began.

Publication outcome will be appended after the signed tag, npm package,
provenance, workflow, and GitHub Release are independently verified.

PR:

- pending
