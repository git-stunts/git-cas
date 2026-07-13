# API-0047 Design Review Witness

**Issue:** https://github.com/git-stunts/git-cas/issues/58

**Goalpost:** https://github.com/git-stunts/git-cas/issues/50

**Review date:** 2026-07-13

**Verdict:** Pass after corrections

## Self-Review

The design was checked against the issue decisions, the METHOD design template,
I-001, the existing RootSet contract, and the `v6.2.0` compatibility boundary.

Confirmed:

- every required design-template section is present
- policy, expiry, and observed Git reachability are distinct axes
- handles identify content but do not claim durability
- application causal meaning remains outside `git-cas`
- existing `v6.x` methods remain compatible
- every runtime claim names executable implementation proof

## Code Lawyer Review

The adversarial review looked for ambiguous guarantees, hidden object-lifetime
gaps, impossible accounting promises, unsafe security eviction, false streaming
claims, and semver overreach.

### CL-001: `maxBytes` was under-specified

**Severity:** High

**Status:** Resolved

Physical Git bytes cannot be assigned exactly to one cache when chunks are
deduplicated or reachable from multiple roots. The design now defines
`maxBytes` as deterministic logical payload bytes from validated manifests and
keeps physical bytes as non-additive doctor evidence.

### CL-002: Pin and expiry precedence was ambiguous

**Severity:** High

**Status:** Resolved

The design now states that explicit expiry authorizes release after expiry even
for a pinned entry. Without expiry, pinned data requires explicit unpin/remove.
An expired `get()` remains non-mutating; sweep performs release.

### CL-003: Handle portability conflicted with the implementation issue

**Severity:** Medium

**Status:** Resolved

Content handles must survive repository relocation, clone, and mirror. The
design and #54 now require repository-location-independent serialization. A
handle fails explicitly when its referenced object graph was not transferred.

### CL-004: Active design was indexed as landed

**Severity:** Medium

**Status:** Resolved

Cycle `0047` remains `active` and is listed with active METHOD cycles.
Implementation and release playback are still pending.

## Residual Constraints

- Capability names are additive design targets; implementation may tighten
  spelling but cannot move ownership back into applications.
- A retention witness is evidence for one observed generation, not a promise
  that a mutable ref remains there.
- Streaming claims require storage-boundary and residency tests in each
  implementation slice.
- Repository-wide physical attribution must return bounded/unknown facts when
  Git cannot prove ownership.

## Validation

- `pnpm run lint` - passed
- `pnpm test` - 192 files passed; 1,686 tests passed; 2 skipped
- `pnpm vitest run test/unit/docs` - 14 files passed; 57 tests passed
- Prettier check for all changed Markdown - passed
- `git diff --check` - passed

This witness proves the design and review gate only. It does not claim that the
new runtime APIs exist before their implementation slices merge.
