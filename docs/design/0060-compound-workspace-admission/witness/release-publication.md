# PERF-0060 v6.5.9 Publication Witness

Date: 2026-08-24

Issue: #123

## Immutable Release Identity

- Implementation PR:
  [#124](https://github.com/git-stunts/git-cas/pull/124)
- Release PR: [#125](https://github.com/git-stunts/git-cas/pull/125)
- Reviewed merge commit: `a16e31a9d4b0dff3b538fe8ad9ad2da31b67b275`
- Signed annotated tag: `v6.5.9`
- Tag object: `df65d8af46c5e4758ab3108272ebc849df58c29e`
- Peeled tag target: `a16e31a9d4b0dff3b538fe8ad9ad2da31b67b275`
- Signing key: `01A63D8E9DBEEDE32918AF9C39560E0406CA9135`
- GitHub Release:
  [v6.5.9](https://github.com/git-stunts/git-cas/releases/tag/v6.5.9)
  (final, not a draft or prerelease; published `2026-08-24T19:12:37Z`)

Local `git tag -v v6.5.9` reported a good signature. GitHub independently
reports the annotated tag signature as valid and verified, and both local
peeling and the GitHub tag object resolve to the reviewed release merge
exactly.

## Release Workflow

[Release run 32766297971](https://github.com/git-stunts/git-cas/actions/runs/32766297971)
completed successfully against tag `v6.5.9` and exact commit
`a16e31a9d4b0dff3b538fe8ad9ad2da31b67b275`:

| Job            | Result | Evidence                                           |
| -------------- | ------ | -------------------------------------------------- |
| Validate       | pass   | Tag version matched `package.json`                 |
| Test           | pass   | Lint, unit, and Node/Bun/Deno real-Git integration |
| Publish npm    | pass   | OIDC trusted publication completed                 |
| GitHub Release | pass   | Final release created after npm publication        |

Before tagging, the exact reviewed merge passed all 14 release-verifier stages
with 7,147 observed tests, public type compatibility, examples, build stamping,
and npm and JSR dry-runs.

## npm Registry Evidence

Independent registry queries after the workflow completed reported:

| Field         | Value                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Package       | `@git-stunts/git-cas@6.5.9`                                                                       |
| Published     | `2026-08-24T19:12:26.166Z`                                                                        |
| Dist-tag      | `latest` -> `6.5.9`                                                                               |
| Git head      | `a16e31a9d4b0dff3b538fe8ad9ad2da31b67b275`                                                        |
| Integrity     | `sha512-shlQB+EgLmzWsWTxRwLUN8rovI1wKv0N2yx43fiAxdOLTqMOOQOxSB8AMLfUmxnVd0zS+/0HIEwXF5ixl046XQ==` |
| Shasum        | `a4fcff9ffd6c50292284903606726d6067636d56`                                                        |
| File count    | `269`                                                                                             |
| Unpacked size | `2,318,806` bytes                                                                                 |
| Tarball       | `https://registry.npmjs.org/@git-stunts/git-cas/-/git-cas-6.5.9.tgz`                              |

The registry exposes the package-version
[attestation endpoint](https://registry.npmjs.org/-/npm/v1/attestations/@git-stunts%2fgit-cas@6.5.9)
with npm publish and `https://slsa.dev/provenance/v1` predicates. The decoded
SLSA statement resolves `refs/tags/v6.5.9` to exact Git commit
`a16e31a9d4b0dff3b538fe8ad9ad2da31b67b275` and workflow run `32766297971`.

## Clean-Room Consumer Smoke

A fresh temporary directory with no source-worktree dependency installed the
exact registry package with:

```bash
npm install --ignore-scripts @git-stunts/git-cas@6.5.9
```

The installed artifact then reported:

- package version `6.5.9`;
- CLI version `6.5.9+a16e31a9`;
- embedded build SHA `a16e31a`;
- successful ESM root import with 45 public exports;
- successful `@git-stunts/git-cas/service` subpath import;
- public `StagingWorkspace.prototype.batch` with a 1,024-operation bound; and
- `npm audit signatures` verified registry signatures for all 20 installed
  packages and attestations for 11, with no invalid or missing results.

This proves that the package consumers receive from npm carries the reviewed
release identity, verifies through the registry trust surfaces, and exposes the
compound admission capability through the public package boundary.

## Compatibility And Downstream Boundary

This release requires no application or stored-data migration. It changes no
application handle, stored object bytes, descriptor schema, ref namespace, or
existing workspace/read contract. Existing repositories remain readable in
place.

This witness closes the git-cas publication gate. It does not claim that
git-warp or Think have consumed the release or that their end-to-end latency is
fixed. The next required sequence remains git-warp consuming v6.5.9 and
publishing its exact reference, migrated-v18, process-census, and CPU evidence,
then Think consuming the released git-warp dependency.
