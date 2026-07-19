# PERF-0052 v6.5.2 Publication Witness

Date: 2026-07-19

Issue: #90

## Immutable Release Identity

- Feature PR: [#91](https://github.com/git-stunts/git-cas/pull/91)
- Release PR: [#92](https://github.com/git-stunts/git-cas/pull/92)
- Reviewed merge commit: `c2d41f608bc9a5e8c19a12ce1024c4c756fd752a`
- Signed annotated tag: `v6.5.2`
- Tag object: `5becfb292460bfa22e6e4dad6cec3c3243e6e88f`
- Peeled tag target: `c2d41f608bc9a5e8c19a12ce1024c4c756fd752a`
- Signing key: `01A63D8E9DBEEDE32918AF9C39560E0406CA9135`
- GitHub Release:
  [v6.5.2](https://github.com/git-stunts/git-cas/releases/tag/v6.5.2)
  (final, not a draft or prerelease; published `2026-07-19T14:30:20Z`)

Local `git tag -v v6.5.2` reported a good signature. The remote tag object and
peeled target match the local tag and reviewed merge commit exactly.

## Release Workflow

[Release run 29690794540](https://github.com/git-stunts/git-cas/actions/runs/29690794540)
completed successfully against `v6.5.2`:

| Job            | Result | Evidence                                       |
| -------------- | ------ | ---------------------------------------------- |
| Validate       | pass   | Tag version matched `package.json`             |
| Test           | pass   | Lint, unit, Node/Bun/Deno real-Git integration |
| Publish npm    | pass   | OIDC trusted publication completed             |
| GitHub Release | pass   | Final release created after npm publication    |

Before tagging, `pnpm run release:verify` passed all 14 steps against the exact
reviewed merge `c2d41f608bc9a5e8c19a12ce1024c4c756fd752a`, observing 6,817
tests and completing public type compatibility, npm package inspection, and the
JSR publication dry-run. The tag push also passed the local pre-push lint and
2,080-test Node unit gate.

## npm Registry Evidence

Independent registry queries after the workflow completed reported:

| Field         | Value                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Package       | `@git-stunts/git-cas@6.5.2`                                                                       |
| Published     | `2026-07-19T14:30:09.505Z`                                                                        |
| Dist-tag      | `latest` -> `6.5.2`                                                                               |
| Integrity     | `sha512-2fZXK52SuaSnO7xxlcAEh6qxnptNIoN2jl0eq5ZYZCisFdtGRGW6I080gC3J40/r35dI32UTtRRY+R3cCd2X1g==` |
| Shasum        | `b2eca5eb490716e3a8156a63e151d0db040ce16c`                                                        |
| File count    | `253`                                                                                             |
| Unpacked size | `2,200,510` bytes                                                                                 |
| Tarball       | `https://registry.npmjs.org/@git-stunts/git-cas/-/git-cas-6.5.2.tgz`                              |

The registry exposes the package-version
[attestation endpoint](https://registry.npmjs.org/-/npm/v1/attestations/@git-stunts%2fgit-cas@6.5.2)
with npm publish and `https://slsa.dev/provenance/v1` predicates. The SLSA
statement resolves the build to Git commit
`c2d41f608bc9a5e8c19a12ce1024c4c756fd752a` from tag `v6.5.2` and release
workflow run `29690794540`, attempt 1.

## Downstream Gate

The registry artifact now satisfies the dependency gate for git-warp. The
git-cas v6.5.2 goalpost can close on this publication evidence, while
[git-stunts/git-warp#738](https://github.com/git-stunts/git-warp/issues/738)
and
[git-stunts/git-warp#758](https://github.com/git-stunts/git-warp/issues/758)
remain open until git-warp consumes published version `6.5.2` and records
executable compatibility, process-tree CPU and wall-clock improvement, Git
command reduction, and larger-than-memory bounded-RSS evidence. A local path
override is not acceptable proof of the released contract.

Publication does not prove that git-warp selects the persistent-session path or
that its end-to-end materialization no longer rebuilds avoidable structure.
Those obligations remain downstream. JSR publication was not claimed or
attempted; its dry-run is healthy, but npm and GitHub Releases are the v6.5.2
publication surfaces.
