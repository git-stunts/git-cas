# v6.5.11 publication witness

PR [#132](https://github.com/git-stunts/git-cas/pull/132) merged as `1bcd6311e93ca9782e2f4a25af106af0651813fb`. Signed annotated tag `v6.5.11` has object `a77ebbdff9b5e2bbce73f90e8d51a5d0cd71b98d` and peels to that exact merge; its SSH signature was verified before push. [Release workflow 37008258240](https://github.com/git-stunts/git-cas/actions/runs/37008258240) completed successfully and created the [GitHub release](https://github.com/git-stunts/git-cas/releases/tag/v6.5.11).

## Registry identity

Npm reports `@git-stunts/git-cas@6.5.11` with gitHead `1bcd6311e93ca9782e2f4a25af106af0651813fb` and integrity `sha512-C6coWmKmOeRZ+X5nP5Ek7spwYpA5q6mgif09u9dDO0ISQQ+Hz4KVxAXrOPRRhNJzLEP74Ndbra55fxX5Cms5gw==`. The artifact requires published Plumbing `^3.3.2`. Initial cached metadata returned 404 after publication; fresh registry metadata and a subsequent clean installation established visibility. No tag or version was rewritten.

## Merged-main verification

All 14 canonical release gates passed inside COPY-based Docker, without host repository or Git mounts. Node and Bun each passed 2,204 unit tests with three existing skips; Deno passed 2,195 with twelve existing skips. Each runtime passed 207 integration tests. Three maintained examples, public types, lint, metadata stamping, npm pack and JSR dry-run passed. The 7,224 total counts observations across runtimes, not unique tests. JSR was validated but is not a publication target of this workflow.

## Independent public consumer

A new Docker image installed the exact npm versions of git-cas 6.5.11 and Plumbing 3.3.2, with no checkout dependencies, patches or host mounts. All six deterministic transport-recovery tests passed. The public store/restore example returned matching bytes and passed integrity verification; the installed CLI reported `6.5.11+1bcd631`. Npm verified 63 registry signatures and 31 attestations across this consumer installation, which includes Vitest as test tooling. Those counts are specific to this fixture, not a package dependency-count guarantee.

## Limits and follow-through

Synthetic transport failures establish bounded retries and error identity; they do not prove every concurrent external-GC race. Git-warp [#923](https://github.com/git-stunts/git-warp/issues/923) owns attachment/GC adoption and evidence. This release does not implement git-warp Runtime/Lane attachments or complete its bounded streaming issue. Deno dependency installation reported an ESLint9 deprecation warning; no warning-free validation claim is made.

The [machine-readable receipt](publication.json) records immutable identities and raw-log SHA-256 digests. Historical preparation and candidate receipts retain their original source coordinates.
