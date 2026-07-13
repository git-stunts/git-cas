# API-0047 Opaque Asset Handle Witness

Implementation slice: [#54](https://github.com/git-stunts/git-cas/issues/54)

Implementation commit: `a9e47ef3025d68b98c752fb1abb826bde856ad83`

Review correction commits:

- `3d6eaa49479fbbc3f6cf6cf191343bc0532783dd`
- `18cd397b24087d232311f973a6cb69d335bb0114`

## Claim

Applications can stream asset bytes into and out of `git-cas`, exchange a
canonical immutable handle, make the referenced graph reachable through a
managed root, or publish it through an allowlisted application ref without
sequencing manifests, trees, payload OIDs, commits, and ref updates themselves.

## Source Evidence

- The facade exposes frozen `assets`, `retention`, and `publications`
  capabilities while preserving the existing low-level surface.
  [cite: `index.js#153-168@a9e47ef3025d68b98c752fb1abb826bde856ad83`]
- `AssetHandle` validates version, kind, format, codec, hash algorithm, and OID,
  and produces one canonical repository-location-independent token.
  [cite: `src/domain/value-objects/AssetHandle.js#25-118@a9e47ef3025d68b98c752fb1abb826bde856ad83`]
- `assets.put()` composes the existing streaming store and manifest-tree path;
  `assets.open()` delegates restored output to `restoreStream()` after handle
  graph validation.
  [cite: `src/domain/services/AssetService.js#26-101@a9e47ef3025d68b98c752fb1abb826bde856ad83`]
- A staged result explicitly says the operation created no retention root. It
  does not mislabel globally deduplicated objects as proven unreachable.
  [cite: `src/domain/value-objects/StagedAsset.js#17-53@fd7e6e5d1b540ad879730adf526d187441155e59`]
- `retention.retain()` validates the handle, installs the tree through RootSet,
  and reports the exact committed generation and evidence path.
  [cite: `src/domain/services/RetentionService.js#37-61@a9e47ef3025d68b98c752fb1abb826bde856ad83`]
- `publications.commit()` validates ordered commit parents and the handle graph,
  creates the application commit, performs an expected-head ref update, and
  returns generation-scoped evidence.
  [cite: `src/domain/services/PublicationService.js#43-134@a9e47ef3025d68b98c752fb1abb826bde856ad83`]
- Witness construction validates policy, observed reachability, root kind,
  fully qualified ref, generation OID, evidence path, and canonical timestamp.
  [cite: `src/domain/value-objects/RetentionWitness.js#22-110@a9e47ef3025d68b98c752fb1abb826bde856ad83`]

## Real Git Evidence

The Docker-gated integration test creates a bare repository and checks Git's
own object and ref behavior:

- a fresh staged tree appears in `git prune -n --expire=now` output;
- RootSet retention removes that tree from the prune candidate set;
- the reported generation and path resolve to the retained tree;
- replacement makes the prior unique tree prunable while retaining the winner;
- application publication preserves caller-controlled parent order;
- a tree OID is rejected as a commit parent;
- a stale expected head reports a conflict without replacing the winning ref;
- one canonical handle opens after mirror transfer and fails explicitly in an
  empty repository.

[cite: `test/integration/application-storage.test.js#102-199@a9e47ef3025d68b98c752fb1abb826bde856ad83`]

## Self-Review

The implementation was reviewed against #54 and API-0047 for ownership,
durability claims, concurrency, compatibility, and runtime-neutral byte
contracts.

- Existing `store`, `restore`, `createTree`, vault, RootSet, and single-parent
  `GitRefPort.createCommit()` callers remain compatible.
- New facade capabilities are additive and lazily share the existing adapters
  and service initialization.
- Publication is disabled without an explicit application ref prefix and
  always rejects Git/CAS-managed ref namespaces, even under a broad `refs/`
  allowlist.
- `expected` is mandatory, including `null` for create-only publication.
- Handles expose content identity but make no durability promise.
- Publication commit IDs remain public application identities; payload object
  traversal remains owned by `git-cas`.
- Complete handle-graph validation deduplicates chunk OIDs and bounds concurrent
  object-type reads by the configured CAS concurrency.

## Code Lawyer Review

### CL-001: Tree peeling did not prove that a parent was a commit

The first draft used `resolveTree(parent)`. Git's `^{tree}` syntax also accepts
a tree OID, so that check could admit a non-commit parent and defer failure to
`commit-tree`. Parent admission now uses `resolveParents()`, and the real-Git
test supplies a tree OID to prove structured rejection.
[cite: `src/domain/services/PublicationService.js#80-99@a9e47ef3025d68b98c752fb1abb826bde856ad83`]

### CL-002: Create-only ref updates assumed SHA-1

The existing adapter used forty zeroes for Git's null OID. It now derives the
null OID width from the new commit ID, preserving SHA-1 behavior and supporting
SHA-256 repositories.
[cite: `src/infrastructure/adapters/GitRefAdapter.js#106-121@a9e47ef3025d68b98c752fb1abb826bde856ad83`]

### CL-003: Overlapping publication allowlists obscured provenance

Allowlisted prefixes are sorted most-specific-first, so a witness for
`refs/warp/cache/events` records `refs/warp/cache/` rather than the broader
`refs/warp/` namespace.
[cite: `src/domain/services/PublicationService.js#188-211@a9e47ef3025d68b98c752fb1abb826bde856ad83`]

### CL-004: Ref observation could mask the original update failure

If the ref update and the subsequent head observation both fail, the service
now reports `PUBLICATION_REF_UPDATE_FAILED` with both causes rather than leaking
an unclassified observation error.
[cite: `src/domain/services/PublicationService.js#101-134@a9e47ef3025d68b98c752fb1abb826bde856ad83`]

### CL-005: Staged reachability cannot be inferred globally under deduplication

The result uses `unanchored` and `not-established` to state that this operation
created no root or protection claim. It does not call the graph `orphaned`,
because identical objects may already be reachable through another ref. The
real-Git prune assertion is deliberately made against fresh unique test
content.
[cite: `src/domain/value-objects/StagedAsset.js#29-39@fd7e6e5d1b540ad879730adf526d187441155e59`]

### CL-006: Sequential validation made large handle graphs latency-bound

Complete handle validation now deduplicates chunk OIDs in one pass and checks
them through a fixed worker pool capped by the CAS concurrency. This avoids one
serial Git round trip per unique chunk without creating one promise per chunk.
The test instruments active object-type reads and proves the configured bound.
[cite: `src/domain/services/AssetService.js#103-121@3d6eaa49479fbbc3f6cf6cf191343bc0532783dd`]
[cite: `test/unit/domain/services/AssetService.test.js#93-122@3d6eaa49479fbbc3f6cf6cf191343bc0532783dd`]

### CL-007: A broad allowlist could authorize Git-managed refs

Publication now hard-blocks core Git and CAS namespaces independently of the
application allowlist. Both reserved prefix configuration and publication below
a reserved namespace fail before commit construction or ref mutation.
[cite: `src/domain/services/PublicationService.js#11-22@3d6eaa49479fbbc3f6cf6cf191343bc0532783dd`]
[cite: `src/domain/services/PublicationService.js#159-168@3d6eaa49479fbbc3f6cf6cf191343bc0532783dd`]
[cite: `src/domain/services/PublicationService.js#200-242@3d6eaa49479fbbc3f6cf6cf191343bc0532783dd`]
[cite: `test/unit/domain/services/PublicationService.test.js#145-184@3d6eaa49479fbbc3f6cf6cf191343bc0532783dd`]

### CL-008: Retention validated RootSet refs after handle resolution

Retention now validates the RootSet namespace before resolving the asset graph.
The negative test proves that a malformed ref performs neither handle
resolution nor ref mutation.
[cite: `src/domain/services/RetentionService.js#37-40@3d6eaa49479fbbc3f6cf6cf191343bc0532783dd`]
[cite: `src/domain/services/RetentionService.js#87-101@3d6eaa49479fbbc3f6cf6cf191343bc0532783dd`]
[cite: `test/unit/domain/services/RetentionService.test.js#93-108@3d6eaa49479fbbc3f6cf6cf191343bc0532783dd`]

## Residual Constraints

- Asset payload ingress and plaintext/framed/convergent egress use the existing
  streaming pipeline. Manifest metadata is still materialized by the existing
  `Manifest` model, and explicit `whole` encryption retains its documented
  bounded compatibility-buffer behavior. This slice does not claim constant
  metadata residency.
- A retention witness proves one observed generation. A mutable ref may move
  afterward.
- This slice publishes `AssetHandle`. Bundle and page handle publication is
  added by #51 through the same resolver boundary.
- A failed compare-and-swap can leave its immutable attempted commit
  unreachable. That object is ordinary Git prune material, not partial
  publication.

## Validation

- `pnpm lint`
- `pnpm test`: 198 files passed; 1,746 tests passed; 2 skipped
- `pnpm test:integration:node`: 7 files and 161 tests passed
- Docker Bun application-storage integration: 3 tests passed
- Docker Deno application-storage integration: 3 tests passed
