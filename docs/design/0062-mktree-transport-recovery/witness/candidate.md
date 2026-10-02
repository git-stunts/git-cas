# Published-dependency candidate witness

Source: `1dfd7d6e4d3344e561d70a791c5bd68eb7a28ee9`; version 6.5.11 candidate. Plumbing 3.3.2 is the published npm dependency, with upstream merge `8811356d4f2277a2a10cd496e5e6f1b94b89f480`. This evidence does not claim git-cas 6.5.11 publication.

## Playback answers

The actual Plumbing session and CAS persistence adapter recover after injected closed-input and broken-pipe transport failures. Six deterministic checks cover single and batched trees, already-closed input, the two-attempt limit, unrelated transport errors, and producer error identity. Against Plumbing 3.3.0, four fail and two pass; against published 3.3.2, all six pass. This injection establishes transport recovery, not an independent real-GC causal witness.

The first full release run caught a stale CLI version export (6.5.10 versus metadata 6.5.11). Commit 1dfd7d6 synchronizes it; three CLI checks pass, followed by all 14 canonical release gates. The attached JSON records the exact checked source and raw-log digest.

## Execution and bounds

All checks ran in COPY-based Docker without host repository or Git mounts. The canonical release verifier orchestrated copied Node/Bun/Deno Compose services. Lint, stamping, npm packing and JSR dry-run used a persistent copied validation container; stamped metadata survived into packaging. Source-only Git metadata identifies the checked commit; graph refs and host configuration were excluded.

Node and Bun unit suites each passed 2,203 with three existing skips. Deno passed 2,194 with twelve existing skips. Each runtime passed 207 integration tests. These are per-runtime observations, not a claim of identical execution coverage. Three maintained examples, public types, lint, stamp, npm pack and JSR dry-run all passed. No release-verification stage was skipped.

## Remaining delivery

Current-head independent review, green hosted CI, merge, verification of merged main, signed tag, registry publication and downstream consumer proof remain required. Keep issue #131 open until delivery. The dependency fix does not implement git-warp Runtime/Lane attachment APIs or complete #818.
