# PERF-0049 v6.4.0 Publication Witness

Date: 2026-07-18

Issues: #75, #77

## Immutable Release Identity

- Release PR: [#78](https://github.com/git-stunts/git-cas/pull/78)
- Reviewed merge commit: `d47af74a288ef362dba684536cff11c063cfdcc3`
- Signed annotated tag: `v6.4.0`
- Tag object: `3545b8aa81e395e832f112214b301dbe53d9576f`
- Peeled tag target: `d47af74a288ef362dba684536cff11c063cfdcc3`
- Signing key: `01A63D8E9DBEEDE32918AF9C39560E0406CA9135`
- GitHub Release:
  [v6.4.0](https://github.com/git-stunts/git-cas/releases/tag/v6.4.0)
  (final, not a draft or prerelease; published `2026-07-18T02:58:40Z`)

Local `git tag -v v6.4.0` reported a good signature. The remote tag object and
peeled target match the local tag and reviewed merge commit exactly.

## Release Workflow

[Release run 29627828620](https://github.com/git-stunts/git-cas/actions/runs/29627828620)
completed successfully against `v6.4.0`:

| Job | Result | Evidence |
| --- | --- | --- |
| Validate | pass | Tag version matched `package.json` |
| Test | pass | Lint, unit, Node/Bun/Deno real-Git integration |
| Publish npm | pass | OIDC trusted publication completed |
| GitHub Release | pass | Final release created after npm publication |

Before tagging, `pnpm run release:verify` passed all 14 steps against version
`6.4.0`, observing 6,538 tests and completing public type compatibility, npm
package inspection, and the JSR publication dry-run. The tag push also passed
the local pre-push lint and 1,993-test Node unit gate.

## npm Registry Evidence

Independent registry queries after the workflow completed reported:

| Field | Value |
| --- | --- |
| Package | `@git-stunts/git-cas@6.4.0` |
| Published | `2026-07-18T02:58:25.447Z` |
| Dist-tag | `latest` -> `6.4.0` |
| Integrity | `sha512-xLtNBCpXolGGusV8efsr/cRlhjrRrFFKZQVwgx/gNtonPVzDor6AyidtILM88ss6M6bJLapGUgOaoimr/y3gZA==` |
| Shasum | `5feda2da0e05bbded738602dd47c8bc1d58a3921` |
| Unpacked size | `2,129,716` bytes |
| Tarball | `https://registry.npmjs.org/@git-stunts/git-cas/-/git-cas-6.4.0.tgz` |

The registry exposes the package-version
[attestation endpoint](https://registry.npmjs.org/-/npm/v1/attestations/@git-stunts%2fgit-cas@6.4.0)
with npm publish and `https://slsa.dev/provenance/v1` predicates. The SLSA
statement resolves the build to Git commit
`d47af74a288ef362dba684536cff11c063cfdcc3` from tag `v6.4.0` and release
workflow run `29627828620`.

## Downstream Gate

The registry artifact now satisfies the dependency gate for git-warp. The
git-cas release goalpost can close on this publication evidence, while
[git-stunts/git-warp#738](https://github.com/git-stunts/git-warp/issues/738)
remains open until git-warp consumes published version `6.4.0` through its
normal package manager and records executable compatibility and performance
evidence. A local path override is not acceptable proof of the released
contract.

Publication does not prove git-warp's unchanged ten-second integration hook or
the direct-workspace performance advantage over its CacheSet workaround. Those
remain downstream gates. JSR publication was not claimed or attempted; its
dry-run is healthy, but npm and GitHub Releases are the v6.4.0 publication
surfaces.
