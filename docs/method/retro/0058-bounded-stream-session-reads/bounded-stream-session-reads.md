# Retro — 0058 Bounded Stream Session Reads

## Drift Check

- The cycle stayed inside the Git persistence adapter, deterministic process
  diagnostics, release evidence, and compatibility documentation.
- It did not widen the public API, change storage or retention truth, cache
  payloads in consumers, or buffer objects above the fixed ceiling.

## What Shipped To Main

- Small `readBlobStream()` payloads at or below 10 MiB can reuse one persistent
  typed `cat-file` session.
- Oversized content remains on exactly one genuine one-shot stream after a
  bounded metadata lookup.
- Unit and SHA-1/SHA-256 real-Git tests prove route selection, exact bytes,
  fixed-bound authority, fallbacks, and deterministic close.
- Implementation PR #116 merged normally as
  `1e30740c8670bf42b8bb863f8feb99a5e0f0f29b`.
- Release PR #117 merged normally as
  `eebc6e37179f4fffd55f6ff7df2cab2613902772`; the signed `v6.5.7` tag peels
  to that exact reviewed merge.
- Release workflow `32637934268` published
  `@git-stunts/git-cas@6.5.7` with npm publish and SLSA provenance plus a final
  GitHub Release. A fresh registry install reported CLI build
  `6.5.7+eebc6e3`.

## What Remains Downstream

- git-warp and Think remain untouched. git-warp must consume the live release,
  rerun its process census, and publish before Think upgrades both dependencies.

## Debt

- None added in git-cas. A persistent truly streaming `cat-file` protocol would
  require separate plumbing ownership and evidence if a future workload
  justifies it.

## Cool Ideas

- Reuse the committed process-count schema when git-warp consumes v6.5.7 so
  downstream improvement is compared structurally, not inferred from timing.
