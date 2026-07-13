# API-0047 Structured Bundle and Page Witness

Implementation slice: [#51](https://github.com/git-stunts/git-cas/issues/51)

Implementation commit: `5fc084de4735c828edeede4c540a9c09531223af`

## Claim

Applications can store bounded immutable pages and deterministic structured
bundles through `git-cas`, exchange opaque handles, stream one selected member
without hydrating unrelated payloads, and retain or publish the resulting Git
object graph without assembling or validating CAS trees themselves.

## Source Evidence

- The facade exposes frozen `pages` and `bundles` capabilities, and the package
  root exports their application-facing handle and staged-result values.
  [cite: `index.js#81-87@5fc084de4735c828edeede4c540a9c09531223af`]
  [cite: `index.js#170-195@5fc084de4735c828edeede4c540a9c09531223af`]
- The shared opaque-handle envelope validates version, kind, format, codec,
  hash algorithm, and OID, then freezes one canonical token representation.
  [cite: `src/domain/value-objects/OpaqueHandle.js#16-44@5fc084de4735c828edeede4c540a9c09531223af`]
  [cite: `src/domain/value-objects/OpaqueHandle.js#68-120@5fc084de4735c828edeede4c540a9c09531223af`]
- Pages enforce a 16 MiB repository default or a lower operation bound, validate
  imported blob type and size through object metadata, and stream output rather
  than using a buffered Git read.
  [cite: `src/domain/services/PageService.js#8-47@5fc084de4735c828edeede4c540a9c09531223af`]
  [cite: `src/domain/services/PageService.js#53-107@5fc084de4735c828edeede4c540a9c09531223af`]
  [cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#205-233@5fc084de4735c828edeede4c540a9c09531223af`]
- `putOrdered()` consumes a canonical ordered iterable incrementally, enforces
  member policy before each addition, and reports bounded staging evidence if a
  later write fails.
  [cite: `src/domain/services/BundleService.js#76-86@5fc084de4735c828edeede4c540a9c09531223af`]
  [cite: `src/domain/services/BundleService.js#179-220@5fc084de4735c828edeede4c540a9c09531223af`]
  [cite: `src/domain/services/StagingEvidence.js#1-39@5fc084de4735c828edeede4c540a9c09531223af`]
- The fanout builder flushes full levels as input arrives, writes deterministic
  descriptor and target edges, enforces depth/width/descriptor budgets, and
  gives the root tree direct transitive Git reachability to every member.
  [cite: `src/domain/services/BundleFanoutBuilder.js#38-90@5fc084de4735c828edeede4c540a9c09531223af`]
  [cite: `src/domain/services/BundleFanoutBuilder.js#92-212@5fc084de4735c828edeede4c540a9c09531223af`]
- Targeted lookup descends only the selected fanout range and `openMember()`
  delegates only the selected page or asset stream. Full graph traversal is a
  separate validation path used by retention and publication.
  [cite: `src/domain/services/BundleService.js#88-138@5fc084de4735c828edeede4c540a9c09531223af`]
  [cite: `src/domain/services/BundleService.js#140-177@5fc084de4735c828edeede4c540a9c09531223af`]
  [cite: `src/domain/services/BundleService.js#313-435@5fc084de4735c828edeede4c540a9c09531223af`]
- One generic resolver validates assets, pages, and nested bundles with a
  bounded operation cache. Retention uses the validated object type directly;
  page publication receives a deterministic one-entry tree because Git commits
  require tree roots.
  [cite: `index.js#275-303@5fc084de4735c828edeede4c540a9c09531223af`]
  [cite: `index.js#374-445@5fc084de4735c828edeede4c540a9c09531223af`]
  [cite: `index.js#908-918@5fc084de4735c828edeede4c540a9c09531223af`]
- Retention witnesses now parse every supported application handle while
  retaining their generation-scoped policy, reachability, and root evidence.
  [cite: `src/domain/value-objects/RetentionWitness.js#14-60@5fc084de4735c828edeede4c540a9c09531223af`]

## Real Git Evidence

The Docker-gated integration test creates a bare repository and proves that:

- identical pages deduplicate and deterministic bundle inputs converge;
- targeted reads return the selected payload;
- RootSet retention makes a bundle and its page transitively non-prunable;
- bundle commits use the bundle tree directly and page commits use the wrapper;
- repeated handles are validated once per operation;
- handles survive mirror transfer and missing graphs fail explicitly.

[cite: `test/integration/application-storage.test.js#174-295@5fc084de4735c828edeede4c540a9c09531223af`]

The synthetic 5,000-member proof observes a fanout tree before the ordered input
source is exhausted, then resolves the last member. The targeted-read proof
also verifies that the unselected payload stream and full-tree fallback are not
called.
[cite: `test/unit/domain/services/BundleService.test.js#174-214@5fc084de4735c828edeede4c540a9c09531223af`]

## Self-Review

The implementation was reviewed against #51 and API-0047 for object ownership,
bounded residency, deterministic identity, imported-handle admission,
transitive reachability, failure evidence, runtime portability, and additive
semver posture.

- `put()` is the explicitly in-memory sorting convenience; `putOrdered()` is
  the bounded construction path.
- Page bytes are one explicitly bounded materialization unit; bundle payloads
  are never collected as one aggregate.
- Bundle tree entries point directly to member roots, so ordinary Git
  reachability, not an external side table, retains transitive content.
- Targeted reads validate selected-member identity and size without opening
  unrelated member streams.
- Retention and publication intentionally validate the complete support graph.
- Existing low-level, vault, RootSet, asset, and publication APIs remain
  compatible; the package-root change is additive.

## Code Lawyer Review

### CL-001: Imported page handles could bypass ingress size limits

Page resolution now asks Git for object size without materializing the blob and
rejects an imported page above repository policy.
[cite: `src/domain/services/PageService.js#74-92@5fc084de4735c828edeede4c540a9c09531223af`]
[cite: `src/infrastructure/adapters/GitPersistenceAdapter.js#205-233@5fc084de4735c828edeede4c540a9c09531223af`]

### CL-002: Persisted bundle policy could be trusted instead of re-enforced

Decoding validates the complete persisted limit envelope, canonical ranges,
counts, order, slots, and member metadata; traversal then rechecks descriptor,
member, fanout, and nesting budgets against repository policy.
[cite: `src/domain/services/BundleDescriptorCodec.js#88-178@5fc084de4735c828edeede4c540a9c09531223af`]
[cite: `src/domain/services/BundleDescriptorCodec.js#180-245@5fc084de4735c828edeede4c540a9c09531223af`]
[cite: `src/domain/services/BundleService.js#278-311@5fc084de4735c828edeede4c540a9c09531223af`]

### CL-003: Validation memoization could become a second materialization

The operation cache retains compact target summaries, caps itself at 1,024
entries, refreshes hits, and keys bundle entries by nesting depth.
[cite: `index.js#374-418@5fc084de4735c828edeede4c540a9c09531223af`]
[cite: `index.js#908-918@5fc084de4735c828edeede4c540a9c09531223af`]

### CL-004: Selected member metadata could disagree with its live target

Targeted and full validation both resolve the member, compare OID/type/size,
and attach bundle and member-path evidence to failures.
[cite: `src/domain/services/BundleService.js#313-344@5fc084de4735c828edeede4c540a9c09531223af`]
[cite: `src/domain/services/BundleService.js#374-401@5fc084de4735c828edeede4c540a9c09531223af`]

### CL-005: Bounded failure evidence had an exact-boundary ambiguity

Separate total counts and 32-entry samples now mark truncation only when an
object or handle was actually omitted.
[cite: `src/domain/services/StagingEvidence.js#1-39@5fc084de4735c828edeede4c540a9c09531223af`]

### CL-006: Invalid clocks could leave avoidable unanchored writes

Page and bundle writes now validate and capture their timestamp before writing
the first object.
[cite: `src/domain/services/PageService.js#37-46@5fc084de4735c828edeede4c540a9c09531223af`]
[cite: `src/domain/services/BundleService.js#179-188@5fc084de4735c828edeede4c540a9c09531223af`]

### CL-007: Logical paths were not fully injective into UTF-8 storage

Path admission now requires NFC, forbids traversal/backslashes/C0-C1 controls,
rejects unpaired surrogates, and enforces the UTF-8 byte budget.
[cite: `src/domain/value-objects/BundlePath.js#12-74@5fc084de4735c828edeede4c540a9c09531223af`]

### CL-008: The documented page default and implementation disagreed

The implementation now uses the documented 16 MiB default, with a regression
test above the former 1 MiB threshold.
[cite: `src/domain/services/PageService.js#8-30@5fc084de4735c828edeede4c540a9c09531223af`]
[cite: `test/unit/domain/services/PageService.test.js#27-37@5fc084de4735c828edeede4c540a9c09531223af`]

### CL-009: Exported staged bundle evidence admitted impossible metadata

`StagedBundle` now requires a positive index depth and normalizes all reported
limits through the same validated `BundleLimits` value object.
[cite: `src/domain/value-objects/StagedBundle.js#20-47@5fc084de4735c828edeede4c540a9c09531223af`]

### CL-010: The initial streaming proof was too small to prove early flush

The final proof drives 5,000 members and asserts that a fanout tree exists after
the first 32 inputs, before source exhaustion.
[cite: `test/unit/domain/services/BundleService.test.js#174-195@5fc084de4735c828edeede4c540a9c09531223af`]

## Residual Constraints

- A page is intentionally materialized as one bounded byte unit during
  `pages.put()` and `pages.get()`; use assets for arbitrarily large streams.
- `bundles.put()` sorts its complete object, `Map`, or array input. Callers whose
  member set may not fit memory must provide canonical order to `putOrdered()`.
- Targeted lookup materializes bounded descriptor nodes along one fanout path
  and validates the selected handle graph. It does not claim zero metadata
  allocation or skip integrity checks for the selected content.
- Complete validation for retention and publication is proportional to the
  support graph by design, but its memoized target summaries are bounded.
- Failed staging or compare-and-swap can leave ordinary unreachable immutable
  Git objects. This API reports bounded evidence and never runs prune or GC.

## Validation

- `pnpm lint`
- `pnpm test`: 203 files passed; 1,783 tests passed; 2 skipped
- `pnpm test:integration:node`: 7 files and 165 tests passed
- `pnpm test:integration:bun`: 7 files and 165 tests passed
- `pnpm test:integration:deno`: 7 files and 165 tests passed
- Graft structural review: 37 files; no breaking changes
- Graft export review: additive minor surface; no removals or changed exports
