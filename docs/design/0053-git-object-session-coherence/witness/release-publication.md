# PERF-0053 v6.5.3 Publication Witness

Date: 2026-07-19

Issue: #94

## Immutable Release Identity

- Feature PR: [#95](https://github.com/git-stunts/git-cas/pull/95)
- Release PR: [#96](https://github.com/git-stunts/git-cas/pull/96)
- Reviewed merge commit: `00df6077f1f9c111b9d0d9b636b7d746df0d2aad`
- Signed annotated tag: `v6.5.3`
- Tag object: `efd1a1e0f9d71cf971a74d254d2661a52b366a81`
- Peeled tag target: `00df6077f1f9c111b9d0d9b636b7d746df0d2aad`
- Signing key: `01A63D8E9DBEEDE32918AF9C39560E0406CA9135`
- GitHub Release:
  [v6.5.3](https://github.com/git-stunts/git-cas/releases/tag/v6.5.3)
  (final, not a draft or prerelease; published `2026-07-19T17:10:48Z`)

Local `git tag -v v6.5.3` reported a good signature. The remote tag object and
peeled target match the local tag and reviewed merge commit exactly.

## Release Workflow

[Release run 29696131557](https://github.com/git-stunts/git-cas/actions/runs/29696131557)
completed successfully against `v6.5.3`:

| Job            | Result | Evidence                                       |
| -------------- | ------ | ---------------------------------------------- |
| Validate       | pass   | Tag version matched `package.json`             |
| Test           | pass   | Lint, unit, Node/Bun/Deno real-Git integration |
| Publish npm    | pass   | OIDC trusted publication completed             |
| GitHub Release | pass   | Final release created after npm publication    |

Before tagging, `pnpm run release:verify` passed all 14 steps against the exact
reviewed merge `00df6077f1f9c111b9d0d9b636b7d746df0d2aad`, observing 6,829
tests and completing public type compatibility, npm package inspection, and the
JSR publication dry-run. The tag push also passed the local pre-push lint and
2,082-test Node unit gate.

## npm Registry Evidence

Independent registry queries after the workflow completed reported:

| Field         | Value                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Package       | `@git-stunts/git-cas@6.5.3`                                                                       |
| Published     | `2026-07-19T17:10:34.025Z`                                                                        |
| Dist-tag      | `latest` -> `6.5.3`                                                                               |
| Integrity     | `sha512-to7bk0BCcp0He5rSwViI7ZD0gb5CL0fFrIPbKpuIwXpuc9MBW0y5AzqvZFGicEncN4iwccEaIZm87paOfpEDrg==` |
| Shasum        | `4010d528abfde6b49739dfa2a4dd0bf41fea4981`                                                        |
| File count    | `254`                                                                                             |
| Unpacked size | `2,203,509` bytes                                                                                 |
| Tarball       | `https://registry.npmjs.org/@git-stunts/git-cas/-/git-cas-6.5.3.tgz`                              |

The registry exposes the package-version
[attestation endpoint](https://registry.npmjs.org/-/npm/v1/attestations/@git-stunts%2fgit-cas@6.5.3)
with npm publish and `https://slsa.dev/provenance/v1` predicates. The SLSA
statement resolves the build to Git commit
`00df6077f1f9c111b9d0d9b636b7d746df0d2aad` from tag `v6.5.3` and release
workflow run `29696131557`, attempt 1.

## Downstream Gate

The registry artifact now satisfies the dependency gate for git-warp. The
git-cas v6.5.3 publication posture is complete, while
[git-stunts/git-warp#738](https://github.com/git-stunts/git-warp/issues/738)
and
[git-stunts/git-warp#758](https://github.com/git-stunts/git-warp/issues/758)
remain open until git-warp consumes published version `6.5.3` and records
executable compatibility, process-tree CPU and wall-clock improvement, Git
command reduction, and larger-than-memory bounded-RSS evidence. A local path
override is not acceptable proof of the released contract.

Publication does not prove that git-warp selects the coherent-session path or
that its end-to-end materialization no longer rebuilds avoidable structure.
Those obligations remain downstream. JSR publication was not claimed or
attempted; its dry-run is healthy, but npm and GitHub Releases are the v6.5.3
publication surfaces.
