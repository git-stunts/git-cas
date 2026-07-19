# PERF-0051 v6.5.1 Publication Witness

Date: 2026-07-18

Issue: #85

## Immutable Release Identity

- Feature PR: [#87](https://github.com/git-stunts/git-cas/pull/87)
- Release PR: [#88](https://github.com/git-stunts/git-cas/pull/88)
- Reviewed merge commit: `49b7d5cb9d589d73fa17d393e48d40bd6f139e57`
- Signed annotated tag: `v6.5.1`
- Tag object: `ed905f8f8cde55ffae08f607dc02f545f9e0565b`
- Peeled tag target: `49b7d5cb9d589d73fa17d393e48d40bd6f139e57`
- Signing key: `01A63D8E9DBEEDE32918AF9C39560E0406CA9135`
- GitHub Release:
  [v6.5.1](https://github.com/git-stunts/git-cas/releases/tag/v6.5.1)
  (final, not a draft or prerelease; published `2026-07-19T00:14:32Z`)

Local `git tag -v v6.5.1` reported a good signature. The remote tag object and
peeled target match the local tag and reviewed merge commit exactly.

## Release Workflow

[Release run 29666480492](https://github.com/git-stunts/git-cas/actions/runs/29666480492)
completed successfully against `v6.5.1`:

| Job            | Result | Evidence                                       |
| -------------- | ------ | ---------------------------------------------- |
| Validate       | pass   | Tag version matched `package.json`             |
| Test           | pass   | Lint, unit, Node/Bun/Deno real-Git integration |
| Publish npm    | pass   | OIDC trusted publication completed             |
| GitHub Release | pass   | Final release created after npm publication    |

Before tagging, `pnpm run release:verify` passed all 14 steps against PR head
`b73ee15a610dbb4a19b265d884c4a232ffdb5808`, observing 6,676 tests and
completing public type compatibility, npm package inspection, and the JSR
publication dry-run. That head and reviewed merge `49b7d5cb` share exact tree
`afe3b71ac88c1bed3220e578956a271a8d848dc2`. The tag push also passed the
local pre-push lint and 2,036-test Node unit gate.

## npm Registry Evidence

Independent registry queries after the workflow completed reported:

| Field         | Value                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Package       | `@git-stunts/git-cas@6.5.1`                                                                       |
| Published     | `2026-07-19T00:14:20.719Z`                                                                        |
| Dist-tag      | `latest` -> `6.5.1`                                                                               |
| Integrity     | `sha512-rRPDuuMUsy1KpysIDlQ0oclUxnECAN+b7TNGOBZdE+c7inqaj3Mv4dHuZ2Bb4I/jKwQ+e13wSSG+IaWfkrmOXw==` |
| Shasum        | `3811131c703a0ccea5f4fdbb906778a6bdd06eb0`                                                        |
| File count    | `250`                                                                                             |
| Unpacked size | `2,158,035` bytes                                                                                 |
| Tarball       | `https://registry.npmjs.org/@git-stunts/git-cas/-/git-cas-6.5.1.tgz`                              |

The registry exposes the package-version
[attestation endpoint](https://registry.npmjs.org/-/npm/v1/attestations/@git-stunts%2fgit-cas@6.5.1)
with npm publish and `https://slsa.dev/provenance/v1` predicates. The SLSA
statement resolves the build to Git commit
`49b7d5cb9d589d73fa17d393e48d40bd6f139e57` from tag `v6.5.1` and release
workflow run `29666480492`.

## Downstream Gate

The registry artifact now satisfies the dependency gate for git-warp. The
git-cas v6.5.1 goalpost can close on this publication evidence, while
[git-stunts/git-warp#738](https://github.com/git-stunts/git-warp/issues/738)
and
[git-stunts/git-warp#758](https://github.com/git-stunts/git-warp/issues/758)
remain open until git-warp consumes published version `6.5.1` and records
executable compatibility, CPU, wall-clock, Git-command, and bounded-memory
evidence. A local path override is not acceptable proof of the released
contract.

Publication does not prove path-local retained-page derivation or eliminate
git-warp's remaining structural root-rebuild cost. That follow-up remains
[git-cas#86](https://github.com/git-stunts/git-cas/issues/86). JSR publication
was not claimed or attempted; its dry-run is healthy, but npm and GitHub
Releases are the v6.5.1 publication surfaces.
