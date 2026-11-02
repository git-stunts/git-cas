# Private reservation transition core

The [design](../durable-reservations.md) is being implemented under [#157](https://github.com/git-stunts/git-cas/issues/157). This checkpoint covers only immutable local attempt records and expected transition refusals. It is not evidence of a public reservation API or storage durability.

The [receipt](transition-core.json) binds exact source hashes, four phase outcomes, original log hashes, coordinator acquisitions/releases and enforced resource limits. Final validation in the existing COPY-only worker passed 46 focused tests, repository lint and 2,269 unit tests (three existing skips; 236 files passed, one skipped). The skips are existing runtime-conditional KDF and blob-write cases, plus the Markdown link check that requires a Git checkout (the COPY-only worker excludes `.git`). No skips were added by this work.

Initial RED was a missing-module import failure with zero executed behavior tests. First GREEN passed the focused tests but failed lint on two oversized test groups; splitting them fixed the cause without suppression. A later semantic correction distinguished already-settled from already-armed, then the focused/lint/full-unit chain passed again on the final source.

The tests exercise both cancellation/arming orders, no repeat arming, direct read settlement, exact original and final evidence, immutable records, cancelled tombstones, invalid keys/bindings, contradictory durable shapes and both Git OID lengths. OID-length cases are model checks, not native SHA-1/SHA-256 persistence tests.

Commands ran in the guarded existing worker: `pnpm exec vitest run test/unit/domain/services/ReservationRecord.test.js --maxWorkers=2 --minWorkers=2`, `pnpm run lint`, and `pnpm exec vitest run test/unit --maxWorkers=2 --minWorkers=2`. Dependencies came from the frozen lock for GREEN. No host test or Git-hook bypass was used.

Outstanding acceptance remains the actual indexed ledger, ordered custody/ref operations, facade/declarations, bounded inspection, native concurrency/failure/GC witnesses, full release gates, independent current-head review and published downstream verification. This evidence cannot close #157.
