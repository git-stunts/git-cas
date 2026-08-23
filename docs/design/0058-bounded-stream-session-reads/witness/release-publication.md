# PERF-0058 v6.5.7 Publication Witness

Date: 2026-08-23

Issue: #115

## Immutable Release Identity

- Implementation PR:
  [#116](https://github.com/git-stunts/git-cas/pull/116)
- Release PR: [#117](https://github.com/git-stunts/git-cas/pull/117)
- Reviewed merge commit: `eebc6e37179f4fffd55f6ff7df2cab2613902772`
- Signed annotated tag: `v6.5.7`
- Tag object: `74ce49dc415365b966b39bf6d2a8a0e2e0d9b846`
- Peeled tag target: `eebc6e37179f4fffd55f6ff7df2cab2613902772`
- Signing key: `01A63D8E9DBEEDE32918AF9C39560E0406CA9135`
- GitHub Release:
  [v6.5.7](https://github.com/git-stunts/git-cas/releases/tag/v6.5.7)
  (final, not a draft or prerelease; published `2026-08-23T12:01:21Z`)

Local `git tag -v v6.5.7` reported a good signature. GitHub independently
reports the annotated tag signature as verified, and both local peeling and the
GitHub tag object resolve to the reviewed release merge exactly.

## Release Workflow

[Release run 32637934268](https://github.com/git-stunts/git-cas/actions/runs/32637934268)
completed successfully against tag `v6.5.7` and exact commit
`eebc6e37179f4fffd55f6ff7df2cab2613902772`:

| Job            | Result | Evidence                                           |
| -------------- | ------ | -------------------------------------------------- |
| Validate       | pass   | Tag version matched `package.json`                 |
| Test           | pass   | Lint, unit, and Node/Bun/Deno real-Git integration |
| Publish npm    | pass   | OIDC trusted publication completed                 |
| GitHub Release | pass   | Final release created after npm publication        |

Before tagging, the exact reviewed merge passed all 14 release-verifier steps
with 6,925 observed tests, public type compatibility, examples, build stamping,
and npm and JSR dry-runs.

## npm Registry Evidence

Independent registry queries after the workflow completed reported:

| Field         | Value                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Package       | `@git-stunts/git-cas@6.5.7`                                                                       |
| Published     | `2026-08-23T12:01:09.382Z`                                                                        |
| Dist-tag      | `latest` -> `6.5.7`                                                                               |
| Git head      | `eebc6e37179f4fffd55f6ff7df2cab2613902772`                                                        |
| Integrity     | `sha512-UkJTvRUOiKmh+g9KjvuArWpOkwoyfPTud1Eo77xw7KPrEa4F8QFnCLl8ay4u6c9pxrHW5Ub0mbkOvihuTRQHhw==` |
| Shasum        | `8b7cb6e2df4b26f980c8373c0551be0ea3cb286e`                                                        |
| File count    | `258`                                                                                             |
| Unpacked size | `2,223,367` bytes                                                                                 |
| Tarball       | `https://registry.npmjs.org/@git-stunts/git-cas/-/git-cas-6.5.7.tgz`                              |

The registry exposes the package-version
[attestation endpoint](https://registry.npmjs.org/-/npm/v1/attestations/@git-stunts%2fgit-cas@6.5.7)
with npm publish and `https://slsa.dev/provenance/v1` predicates. The decoded
SLSA statement resolves `refs/tags/v6.5.7` to exact Git commit
`eebc6e37179f4fffd55f6ff7df2cab2613902772` and workflow run `32637934268`.

## Clean-Room Consumer Smoke

A fresh temporary directory with no source-worktree dependency installed the
exact registry package with:

```bash
npm install --no-audit --no-fund @git-stunts/git-cas@6.5.7
```

The installed artifact then reported:

- package version `6.5.7`;
- CLI version `6.5.7+eebc6e3`;
- embedded build SHA `eebc6e3`;
- successful ESM root import with 43 public exports; and
- successful `@git-stunts/git-cas/service` subpath import.

This proves that the package consumers receive from npm carries the reviewed
release identity and loads through the documented public package boundaries.

## Downstream Boundary

This witness closes the git-cas publication gate. It does not claim that
git-warp or Think have consumed the release or that their end-to-end latency is
fixed. The next required sequence remains git-warp consuming v6.5.7 and
publishing its own measured process census, then Think consuming both released
dependencies.
