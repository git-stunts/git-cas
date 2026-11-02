# Bounded immutable reservation point index

The private `ReservationIndex` produces immutable candidate trees. It does not
publish a ledger ref, count capacity or acknowledge custody. [#157](https://github.com/git-stunts/git-cas/issues/157)
and [draft PR #158](https://github.com/git-stunts/git-cas/pull/158) remain open.

## Implemented boundary

- A versioned, domain-separated SHA-256 route has 64 hexadecimal digits.
  Each ordered node has at most 16 children; the final children are record blobs.
- A lookup or update reads at most 64 tree nodes and one record. An update
  writes one record blob and 64 bounded trees, preserving untouched sibling
  OIDs. Tests check the same call bound with one and 129 stored records.
- Metadata type and a 2 KiB tree bound are checked before materializing entries.
  Records have a 16 KiB metadata/read/parser limit. Runtime constructors reject
  invalid names, modes, ordering, duplicates, OIDs and mixed object formats.
- The injected codec reconstructs a validated frozen record and rejects extra
  fields, duplicate JSON fields, contradictory phases and alternative encoding.
- Exact key comparison detects a colliding or misplaced leaf. Earlier snapshot
  roots and cancelled tombstones remain immutable. This validates the selected
  path only, not unvisited subtrees or the whole namespace count.

The test-injected numeric routing name `0` exposed a real mistake: JavaScript
regular-expression coercion admitted it, then string lookup returned `null`.
`index-entry-red-01` executed the regression and failed because corrupt evidence
became absence. Explicit string validation fixed that failure. This behavioral
RED is distinct from the earlier missing-module RED, which ran zero tests.

## Validation

The final guarded COPY-only phase `index-native-green-03` passed:

- 84 focused unit tests: 46 lifecycle, 21 index and 17 codec cases.
- Two native Git cases, one SHA-1 and one SHA-256. Each writes 17 records,
  cancels the first through a new index tree, pins first/current trees under
  explicit test refs, closes adapters, runs real GC, reopens and reads both
  snapshots and every current record.
- Repository lint and the complete Node unit selection: 2,307 passed, three
  existing conditional skips; 238 files passed and one skipped.

The native harness supplies retention roots outside the reservation service.
It proves Git can preserve these index trees, not that reservations admit or
retain anything. No capacity race, response-loss, custody, public API or
released-package result is claimed. The full reservation protocol still needs
its own cross-process, fault, restart, GC, pagination and bounded-work evidence.

[The receipt](point-index.json) binds exact changed source hashes, phase/log
hashes, outcomes, coordinator receipts and enforced resource limits. Dependencies
for GREEN came from the frozen pnpm lock. The source archive excludes host Git
directories; there were no host tests or hook bypasses. The first numeric-name
fix passed tests but exceeded the complexity limit; extracting the owning
name-validation routine fixed lint before the full final chain.

The existing worker was reused and stopped after every phase. Runtime stores,
dependencies and temporary files stayed inside bounded tmpfs; fixture cleanup
ran after each native case. Reported usage is end-of-phase usage, not sampled
peak usage. The tmpfs caps enforce the bound.

## Remaining gates

Next are the namespace policy/header, checked ledger admission and lifecycle
publication, ordered custody operations, bounded inspection and facade. Native
fault/race evidence, independent current-head review and published downstream
verification remain mandatory. [#159](https://github.com/git-stunts/git-cas/issues/159)
tracks the Deno install failure caused by fresh resolution of an incomplete
optional dependency release; Node unit evidence does not waive that runtime gate.
