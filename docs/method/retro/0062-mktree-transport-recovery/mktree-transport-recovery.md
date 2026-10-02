# Retro — 0062 Mktree transport recovery

## Drift check

The fix stayed at the owning dependency boundary: Plumbing classifies transport failures; CAS retains its existing one-retry immutable-object policy. No duplicate runtime patch, mutable-ref retry, stored format change or attachment API claim was introduced.

## Shipped result

PR #132 merged as `1bcd6311e93ca9782e2f4a25af106af0651813fb`. The signed v6.5.11 tag, npm artifact and successful release workflow agree on that commit. Full merged-main verification passed all 14 gates in Docker, followed by an independent public registry consumer. The publication witness records identities and proof limits.

## What the audit caught

The release gate caught the stale CLI version export. A separate self-audit found the legacy host BATS dispatcher and replaced it with direct Docker orchestration. Independent review identified a temporary validation Dockerfile in the JSR dry-run payload; removing that private harness input restored a clean payload. An approved review did not replace further scrutiny.

## Remaining work and debt

Git-warp #923 owns dependency adoption and real attachment/GC acceptance; #818 and #901 own bounded streams and public attachment capability. Synthetic fault recovery is not a claim about every GC interleaving. Deno installation emitted an ESLint9 deprecation warning; all lint and runtime checks still passed. Existing runtime-specific skips remain explicit in the release witness.

## Next release process

Advance the CLI version export alongside metadata, inspect every executable validation entry point, and keep generated validation Dockerfiles outside publishable source. Separate candidate evidence, publication evidence, and downstream capability evidence by immutable source coordinates.
