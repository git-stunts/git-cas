# PERF-0054 v6.5.4 Publication Witness

Date: 2026-07-26

Issue: #99

## Immutable Release Identity

- Feature PR: [#100](https://github.com/git-stunts/git-cas/pull/100)
- Release PR: [#101](https://github.com/git-stunts/git-cas/pull/101)
- Reviewed merge commit: `a2d23f5bfc5d00eecab897eadd9072dab4aff534`
- Signed annotated tag: `v6.5.4`
- Tag object: `554d552ed957d5bbe2ad1c685309ae64359ff7ea`
- Peeled tag target: `a2d23f5bfc5d00eecab897eadd9072dab4aff534`
- Signing key: `01A63D8E9DBEEDE32918AF9C39560E0406CA9135`
- GitHub Release:
  [v6.5.4](https://github.com/git-stunts/git-cas/releases/tag/v6.5.4)
  (final, not a draft or prerelease; published `2026-07-26T14:00:02Z`)

Local `git tag -v v6.5.4` reported a good signature. The tag peels to the
reviewed release merge exactly.

## Release Workflow

[Release run 30205009357](https://github.com/git-stunts/git-cas/actions/runs/30205009357)
completed successfully against `v6.5.4`:

| Job            | Result | Evidence                                       |
| -------------- | ------ | ---------------------------------------------- |
| Validate       | pass   | Tag version matched `package.json`             |
| Test           | pass   | Lint, unit, Node/Bun/Deno real-Git integration |
| Publish npm    | pass   | OIDC trusted publication completed             |
| GitHub Release | pass   | Final release created after npm publication    |

Before tagging, the release candidate passed all 14 verifier steps with 6,844
observed tests, public type compatibility, examples, build stamping, and npm
and JSR dry-runs.

## npm Registry Evidence

Independent registry queries after the workflow completed reported:

| Field         | Value                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Package       | `@git-stunts/git-cas@6.5.4`                                                                       |
| Published     | `2026-07-26T13:59:48.429Z`                                                                        |
| Dist-tag      | `latest` -> `6.5.4`                                                                               |
| Integrity     | `sha512-3C7kWprQl6cPz0P1DPIW/T04ujucn276LJv0zK+QmwI83t6smTx2PLDulOTlpumlP4SVOFY2cUTyd/1gtgbgkA==` |
| Shasum        | `bcf4784d4c05a08a8bb95f03038f680dc5ed90a8`                                                        |
| File count    | `255`                                                                                             |
| Unpacked size | `2,209,770` bytes                                                                                 |
| Tarball       | `https://registry.npmjs.org/@git-stunts/git-cas/-/git-cas-6.5.4.tgz`                              |

The registry exposes the package-version
[attestation endpoint](https://registry.npmjs.org/-/npm/v1/attestations/@git-stunts%2fgit-cas@6.5.4)
with npm publish and `https://slsa.dev/provenance/v1` predicates.

## Downstream Gate

The v6.5.4 artifact supplies the batch-retention dependency required by
git-warp's migration implementation. It does not by itself prove that the
complete retained-substrate migration succeeds. That executable downstream
obligation remains with git-warp v19.
