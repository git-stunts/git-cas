# PERF-0048 v6.3.0 Publication Witness

Date: 2026-07-17

Issues: #69, #70

## Immutable Release Identity

- Release PR: [#73](https://github.com/git-stunts/git-cas/pull/73)
- Reviewed merge commit: `33f4171f6b69d75110de834f9a75d64e2d14e1a3`
- Signed annotated tag: `v6.3.0`
- Tag object: `ef65b74e9a8bd94413d30039a4b37f9b28287c3c`
- Peeled tag target: `33f4171f6b69d75110de834f9a75d64e2d14e1a3`
- Signing key: `01A63D8E9DBEEDE32918AF9C39560E0406CA9135`
- GitHub Release:
  [v6.3.0](https://github.com/git-stunts/git-cas/releases/tag/v6.3.0)
  (final, not a draft or prerelease; published `2026-07-17T08:24:30Z`)

Local `git tag -v v6.3.0` reported a good signature. The remote tag object and
peeled target match the local tag and reviewed merge commit exactly.

## Release Workflow

[Release run 29566015478](https://github.com/git-stunts/git-cas/actions/runs/29566015478)
completed successfully against `v6.3.0`:

| Job | Result | Evidence |
| --- | --- | --- |
| Validate | pass | Tag version matched `package.json` |
| Test | pass | Lint, unit, Node/Bun/Deno real-Git integration |
| Publish npm | pass | OIDC trusted publication completed |
| GitHub Release | pass | Final release created after npm publication |

Before tagging, `pnpm run release:verify` passed all 14 steps against version
`6.3.0`, observing 6,325 tests and completing public type compatibility, npm
package inspection, and the JSR publication dry-run.

## npm Registry Evidence

Independent registry queries after the workflow completed reported:

| Field | Value |
| --- | --- |
| Package | `@git-stunts/git-cas@6.3.0` |
| Published | `2026-07-17T08:24:19.219Z` |
| Dist-tag | `latest` -> `6.3.0` |
| Integrity | `sha512-Cl/WPjj60LvjXl3BqSb1M3a0tx2xpx6KxGEC1TXKekNzgn5so/t43LG7Qz2XuXle+YmXWoCi8H94cJYvfgI8Yw==` |
| Shasum | `3244dcaecf80b17de2b4be0129747678ec27d0f8` |
| Unpacked size | `2,054,933` bytes |
| Tarball | `https://registry.npmjs.org/@git-stunts/git-cas/-/git-cas-6.3.0.tgz` |

The registry exposes the package-version
[attestation endpoint](https://registry.npmjs.org/-/npm/v1/attestations/@git-stunts%2fgit-cas@6.3.0)
with npm publish and `https://slsa.dev/provenance/v1` predicates. The SLSA
statement resolves the build to Git commit
`33f4171f6b69d75110de834f9a75d64e2d14e1a3` from tag `v6.3.0` and release
workflow run `29566015478`.

## Downstream Gate

The registry artifact now satisfies the dependency gate for git-warp. Issue
#69 remains open until git-warp consumes published version `6.3.0` through its
normal package manager and records executable handoff evidence. A local path
override is not acceptable proof of the released contract.

JSR publication was not claimed or attempted. Its dry-run is healthy, but npm
and GitHub Releases are the v6.3.0 publication surfaces.
