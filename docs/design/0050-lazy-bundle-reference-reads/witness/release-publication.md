# PERF-0050 v6.5.0 Publication Witness

Date: 2026-07-18

Issue: #81

## Immutable Release Identity

- Feature PR: [#82](https://github.com/git-stunts/git-cas/pull/82)
- Release PR: [#83](https://github.com/git-stunts/git-cas/pull/83)
- Reviewed merge commit: `f464b9292a07dbc98cda24aad6712e9d9a3bcefa`
- Signed annotated tag: `v6.5.0`
- Tag object: `fa955936f1e3feb4fe07e8456b983d5a535801a8`
- Peeled tag target: `f464b9292a07dbc98cda24aad6712e9d9a3bcefa`
- Signing key: `01A63D8E9DBEEDE32918AF9C39560E0406CA9135`
- GitHub Release:
  [v6.5.0](https://github.com/git-stunts/git-cas/releases/tag/v6.5.0)
  (final, not a draft or prerelease; published `2026-07-18T18:15:06Z`)

Local `git tag -v v6.5.0` reported a good signature. The remote tag object and
peeled target match the local tag and reviewed merge commit exactly.

## Release Workflow

[Release run 29655337483](https://github.com/git-stunts/git-cas/actions/runs/29655337483)
completed successfully against `v6.5.0`:

| Job            | Result | Evidence                                       |
| -------------- | ------ | ---------------------------------------------- |
| Validate       | pass   | Tag version matched `package.json`             |
| Test           | pass   | Lint, unit, Node/Bun/Deno real-Git integration |
| Publish npm    | pass   | OIDC trusted publication completed             |
| GitHub Release | pass   | Final release created after npm publication    |

Before tagging, `pnpm run release:verify` passed all 14 steps against the exact
reviewed merge commit, observing 6,625 tests and completing public type
compatibility, npm package inspection, and the JSR publication dry-run. Its npm
dry-run contained 249 files totaling 769,786 packed bytes and 2,149,364 unpacked
bytes. The tag push also passed the local pre-push lint and 2,020-test Node unit
gate.

## npm Registry Evidence

Independent registry queries after the workflow completed reported:

| Field         | Value                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Package       | `@git-stunts/git-cas@6.5.0`                                                                       |
| Published     | `2026-07-18T18:14:51.865Z`                                                                        |
| Dist-tag      | `latest` -> `6.5.0`                                                                               |
| Integrity     | `sha512-KfKperNdXu3xWw07tpo1yYpLTynhwAP60PhYiZ5MRsSydPdNspQzJmi6Pv0Jz+6WULD883/NJCR0V1IUhBwOBw==` |
| Shasum        | `4d05349bb8373bab57e12be65621bdc08325f278`                                                        |
| File count    | `249`                                                                                             |
| Unpacked size | `2,149,363` bytes                                                                                 |
| Tarball       | `https://registry.npmjs.org/@git-stunts/git-cas/-/git-cas-6.5.0.tgz`                              |

The registry exposes the package-version
[attestation endpoint](https://registry.npmjs.org/-/npm/v1/attestations/@git-stunts%2fgit-cas@6.5.0)
with npm publish and `https://slsa.dev/provenance/v1` predicates. The SLSA
statement resolves the build to Git commit
`f464b9292a07dbc98cda24aad6712e9d9a3bcefa` from tag `v6.5.0` and release
workflow run `29655337483`.

## Downstream Gate

The registry artifact now satisfies the dependency gate for git-warp. The
git-cas v6.5.0 goalpost can close on this publication evidence, while
[git-stunts/git-warp#738](https://github.com/git-stunts/git-warp/issues/738)
remains open until git-warp consumes published version `6.5.0` through its
normal package manager and records executable compatibility and performance
evidence. A local path override is not acceptable proof of the released
contract.

Publication does not prove git-warp's runtime-scoped acquisition reuse, CPU
budget, or bounded-memory behavior on a logical graph larger than its process
memory cap. Those remain downstream gates. JSR publication was not claimed or
attempted; its dry-run is healthy, but npm and GitHub Releases are the v6.5.0
publication surfaces.
