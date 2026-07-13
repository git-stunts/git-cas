# API-0047 Repository Diagnostics Witness

Implementation slices:

- [#49](https://github.com/git-stunts/git-cas/issues/49)
- [#55](https://github.com/git-stunts/git-cas/issues/55)

Implementation commit: `868cc7080513f8fed71f28dd93bb744ebdf0fc85`

## Claim

`git-cas` owns non-mutating repository-wide CAS diagnostics. The public facade
streams total object, reachable-object, prunable-object, and ref evidence;
classifies anchored, orphaned, and volatile objects under an explicit grace
policy; and reports CacheSet, RootSet, ExpiringSet, and Vault usage without
claiming physical-byte attribution that Git cannot prove.

## Source Evidence

- The frozen `cas.diagnostics.doctor()` capability initializes its focused
  service lazily, after the existing Git-backed collection registries and vault
  are available.
  [cite: `index.js#184-196@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
  [cite: `index.js#306-318@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
  [cite: `index.js#404-410@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
- The repository port exposes only streamed inventories and one reachable-byte
  query. It has no object-write, ref-update, garbage-collection, or destructive
  prune method.
  [cite: `src/ports/RepositoryInspectionPort.js#1-33@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
- The Git adapter streams structured object metadata, all ref-and-reflog
  reachable OIDs, refs, and reachable disk usage. Volatile inspection delegates
  exclusively to `GitPlumbing.inspectPrunableObjects()`.
  [cite: `src/infrastructure/adapters/GitRepositoryInspectionAdapter.js#29-100@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
- Stream parsing handles arbitrary chunk boundaries, validates OIDs, object
  types, and safe-integer byte counts, and rejects nonzero Git completion.
  [cite: `src/infrastructure/adapters/GitRepositoryInspectionAdapter.js#103-161@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
- RepositoryDoctor derives unreachable and orphaned counts by checked
  arithmetic, keeps physical attribution unknown where classes overlap shared
  storage, and fails closed when concurrent repository writes violate its
  inventory invariants.
  [cite: `src/domain/services/RepositoryDoctor.js#25-68@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
  [cite: `src/domain/services/RepositoryDoctor.js#71-105@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
- Managed refs are consumed one at a time. Every observed collection is
  inspected and included in health and totals; `maxCollectionsPerKind` caps
  only retained detail rows.
  [cite: `src/domain/services/RepositoryDoctor.js#108-163@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
  [cite: `src/domain/services/RepositoryDoctor.js#399-489@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
- Known Git evidence limits are first-class report data: shared physical bytes,
  packed-object age, reflog cardinality, alternate stores, pack metadata, and
  detail truncation are never silently estimated.
  [cite: `src/domain/services/RepositoryDoctor.js#539-583@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]

## Real Git Evidence

The Docker-gated integration proof creates a bare repository containing a live
branch, annotated tag, reflog-only commit, CacheSet, RootSet, ExpiringSet,
Vault entry, recent unreachable blob, and old unreachable blob. It verifies
that the reflog object remains anchored, the recent blob remains orphaned, the
old blob is volatile under the exact cutoff, managed usage is visible, and the
complete object-ID and ref inventories are byte-for-byte unchanged after
doctor runs.

[cite: `test/integration/repository-diagnostics.test.js#67-109@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
[cite: `test/integration/repository-diagnostics.test.js#115-168@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]

## Self-Review

The implementation was reviewed against #49, #55, and API-0047 for command
safety, reachability semantics, reflog coverage, grace policy, bounded memory,
shared-byte attribution, concurrent writes, privacy, immutable output, runtime
portability, and additive semver posture.

- Repository diagnostics expose no mutation primitive.
- Git output is parsed structurally instead of inferred from prose.
- Full object and ref inventories stream; managed collections are inspected
  sequentially; only bounded detail rows remain resident.
- Reachability, retention policy, expiry, logical bytes, and physical bytes stay
  separate dimensions.
- Unknown or unprovable values are `null` with explicit limitations.
- Graft reports only additive source symbols and no removed or changed export.
- Graft structural/reference coverage finds test references for
  `RepositoryDoctor`, `GitRepositoryInspectionAdapter`, and
  `RepositoryInspectionPort`.

## Code Lawyer Review

### CL-001: A detail cap could silently undercount repository usage

All managed refs are inspected sequentially and update aggregate health and
totals before the detail-row cap is applied. Coverage distinguishes observed,
inspected, and detailed cardinality.
[cite: `src/domain/services/RepositoryDoctor.js#108-134@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
[cite: `src/domain/services/RepositoryDoctor.js#428-480@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
[cite: `test/unit/domain/services/RepositoryDoctor.test.js#179-214@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]

### CL-002: Diagnostics could accidentally expose destructive prune

The adapter receives only the safe plumbing inspection stream. The port cannot
write objects, update refs, run GC, or request destructive prune.
[cite: `src/ports/RepositoryInspectionPort.js#1-33@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
[cite: `src/infrastructure/adapters/GitRepositoryInspectionAdapter.js#57-71@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]

### CL-003: Independent writers could make subtraction look authoritative

Negative or unsafe derived counts make the report unhealthy, replace derived
counts with `null`, and emit `REPOSITORY_CHANGED_DURING_INSPECTION`.
[cite: `src/domain/services/RepositoryDoctor.js#32-42@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
[cite: `src/domain/services/RepositoryDoctor.js#80-103@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
[cite: `test/unit/domain/services/RepositoryDoctor.test.js#240-265@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]

### CL-004: Deduplicated physical bytes could be double-counted by owner

Per-cache, per-root-set, per-vault, orphaned, and volatile physical bytes remain
unknown. The report states why, while repository total, anchored, and combined
unreachable bytes use compatible Git evidence.
[cite: `src/domain/services/RepositoryDoctor.js#90-104@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
[cite: `src/domain/services/RepositoryDoctor.js#539-560@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]

### CL-005: Chunked or failed Git output could be partially trusted

The line decoder preserves partial chunks until delimiters arrive, flushes the
decoder, validates every structured field, and checks stream completion status.
Unit tests cover arbitrary boundaries, malformed output, and nonzero status.
[cite: `src/infrastructure/adapters/GitRepositoryInspectionAdapter.js#103-161@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
[cite: `test/unit/infrastructure/adapters/GitRepositoryInspectionAdapter.test.js#34-58@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
[cite: `test/unit/infrastructure/adapters/GitRepositoryInspectionAdapter.test.js#114-144@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]

### CL-006: A safe integer can still exceed the JavaScript Date range

Grace policy validates both integer shape and the computed timestamp before
calling `toISOString()`, preserving the documented CAS error surface.
[cite: `src/domain/services/RepositoryDoctor.js#259-272@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
[cite: `test/unit/domain/services/RepositoryDoctor.test.js#267-287@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]

### CL-007: Repository doctor could demand or leak a privacy-vault key

Privacy metadata returns healthy but unknown entry cardinality and an explicit
limitation without invoking `readState()`.
[cite: `src/domain/services/RepositoryDoctor.js#165-205@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
[cite: `test/unit/domain/services/RepositoryDoctor.test.js#216-238@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]

### CL-008: Eager diagnostics wiring could break existing facade adapters

The facade installs a frozen forwarding capability immediately but constructs
the adapter and doctor only after the first diagnostics request and after the
ordinary service registries exist.
[cite: `index.js#184-196@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
[cite: `index.js#404-410@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]
[cite: `test/unit/facade/ContentAddressableStore.diagnostics.test.js#21-68@868cc7080513f8fed71f28dd93bb744ebdf0fc85`]

## Verification

- Node unit: 212 files, 1,866 passed, 2 skipped.
- Bun unit: 211 files passed, 1 skipped; 1,865 passed, 3 skipped.
- Deno unit: 212 files, 1,866 passed, 2 skipped.
- Node real-Git integration: 10 files, 174 passed.
- ESLint and `git diff --check` passed.

