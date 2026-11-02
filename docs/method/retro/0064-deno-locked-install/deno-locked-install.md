# Retro — 0064 Frozen Deno project graph

## Integrated result

PR #160 merged as `9a33df5b7723459fd0c33b8ff6ce012610d626b2` on 2026-11-02,
closing #159. Its final head `b1e951d` had CodeRabbit approval, resolved review
threads and successful lint, unit and Node/Bun/Deno Docker CI jobs. The old
changes-requested review was superseded by the same reviewer's approval; a
stale approval was not counted after the documentation follow-up.

The Deno image installs the existing pnpm lock with the frozen-lock flag.
CI, release-runner, release-workflow and documented Deno commands explicitly
execute that local graph in manual mode. No dependency version range, package
API or storage format changed. Integration is not a registry release.

## What changed our understanding

The missing upstream optional package appeared while we investigated. A fresh
baseline installation therefore succeeded but selected a different graph. The
version assertion, rather than the old registry failure, supplied reproducible
RED evidence. The historical hosted failure and successful local baseline are
preserved as different events.

Review corrected an overbroad claim about optional packages. Missing native
extraction is supported by the pinned codec; it need not fail installation.
Controlled removal produced a working fallback under Node and Deno. That test
does not prove every optional installer failure is harmless.

Review also required complete source identities for modified Docker copies.
The witnesses now reconstruct every copied regular-file hash from an exact
base plus exhaustive changes/removals. A base commit alone did not identify
the tested source. Original receipts remain unchanged.

The independent review caught explicit manual mode missing from release paths.
A release-runner argument regression failed as expected, then passed with the
corrected actual command. It does not assert that an unflagged Deno default
was observed drifting. The last bot review caught historical design text still
labelled Current Truth; the final documentation follow-up distinguishes it.

## Drift check

The implementation remains an installer/runtime-command repair. Reservation
behavior stays in #157; its branch integrates this prerequisite by a normal
merge, preserving both changelog entries and both design links. There is no
new optional-acceleration requirement, unlocked second Deno install, hidden
nonzero install exit or dependency override. Existing runtime-specific skips
are retained in the witnesses rather than counted as passes.

## Remaining debt and release boundary

#161 owns the pre-existing unlocked Bun image installation; it is independent
of this repair. The review's pre-existing release-workflow permission warning
was surfaced, not fixed by this installer change. Base-image tags and the
package-manager major are outside the project-graph reproducibility claim.

The v7.1.0 milestone still requires complete reservation acceptance, review,
publication and a fresh downstream registry consumer. Closing #159 does not
close #157, ship the Optics API or establish a released reservation capability.
