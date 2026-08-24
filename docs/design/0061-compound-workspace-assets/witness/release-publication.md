# PERF-0061 v6.5.10 Publication Witness

Date: 2026-08-24

Issue: #127

## Immutable Release Identity

- Implementation PR:
  [#128](https://github.com/git-stunts/git-cas/pull/128)
- Release PR: [#129](https://github.com/git-stunts/git-cas/pull/129)
- Reviewed merge commit: `4316f4ec7eeda531c07627d2ad0d15c1fcade2f8`
- Signed annotated tag: `v6.5.10`
- Tag object: `37e2b32f501b09abd10130cf0046e2a99885f5f3`
- Peeled tag target: `4316f4ec7eeda531c07627d2ad0d15c1fcade2f8`
- Signing key: `01A63D8E9DBEEDE32918AF9C39560E0406CA9135`
- GitHub Release:
  [v6.5.10](https://github.com/git-stunts/git-cas/releases/tag/v6.5.10)
  (final, not a draft or prerelease; published `2026-08-24T22:05:09Z`)

Local `git verify-tag v6.5.10` reported a good signature. GitHub independently
reports the annotated tag signature as valid and verified. Local peeling and
the GitHub tag object both resolve to the reviewed release merge exactly.

## Release Workflow

[Release run 32782415971](https://github.com/git-stunts/git-cas/actions/runs/32782415971)
completed successfully against tag `v6.5.10` and exact commit
`4316f4ec7eeda531c07627d2ad0d15c1fcade2f8`:

| Job            | Result | Evidence                                           |
| -------------- | ------ | -------------------------------------------------- |
| Validate       | pass   | Tag version matched `package.json`                 |
| Test           | pass   | Lint, unit, and Node/Bun/Deno real-Git integration |
| Publish npm    | pass   | OIDC trusted publication completed                 |
| GitHub Release | pass   | Final release created after npm publication        |

Before tagging, the exact reviewed merge passed all 14 release-verifier stages
with 7,192 observed tests, public type compatibility, examples, build stamping,
and npm and JSR dry-runs. The explicit tag push also passed the repository's
pre-push lint and 2,194-test Node unit gate.

## npm Registry Evidence

Independent registry queries after the workflow completed reported:

| Field         | Value                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Package       | `@git-stunts/git-cas@6.5.10`                                                                      |
| Published     | `2026-08-24T22:04:55.645Z`                                                                        |
| Dist-tag      | `latest` -> `6.5.10`                                                                              |
| Git head      | `4316f4ec7eeda531c07627d2ad0d15c1fcade2f8`                                                        |
| Integrity     | `sha512-JemWVMtuzqArMyxnIMBBQFMOIQ3CsvhXKfza9aIjNPxQ3MBt7J/Hm2ePr3k7Z+wtM+MO38BTGA7gzCZ/Hpld4w==` |
| Shasum        | `3592d2b86ad7e8ab54ae8809d6de977c8eee5ad2`                                                        |
| File count    | `270`                                                                                             |
| Unpacked size | `2,331,318` bytes                                                                                 |
| Tarball       | `https://registry.npmjs.org/@git-stunts/git-cas/-/git-cas-6.5.10.tgz`                             |

The registry exposes the package-version
[attestation endpoint](https://registry.npmjs.org/-/npm/v1/attestations/@git-stunts%2fgit-cas@6.5.10)
with npm publish and `https://slsa.dev/provenance/v1` predicates. The decoded
SLSA statement resolves `refs/tags/v6.5.10` to exact Git commit
`4316f4ec7eeda531c07627d2ad0d15c1fcade2f8` and workflow run `32782415971`.

## Clean-Room Consumer Smoke

A fresh temporary bare Git repository with no source-worktree dependency
installed the exact registry package with:

```bash
npm install --ignore-scripts @git-stunts/git-cas@6.5.10
```

The installed artifact then reported:

- package version `6.5.10`;
- CLI version `6.5.10+4316f4e`;
- embedded build SHA `4316f4e`;
- successful ESM root import with 45 public exports;
- successful `@git-stunts/git-cas/service` subpath import;
- public `StagingWorkspace.prototype.batch`;
- successful real-Git compound admission using `scope.assets.putBatch()`, an
  ordered bundle wave, and the synchronous `retain(value)` selector;
- exact payload readback through the retained terminal bundle;
- exactly one selected terminal root in the retention evidence; and
- `npm audit signatures` verified registry signatures for all 20 installed
  packages and attestations for 11, with no invalid or missing results.

This proves that the package consumers receive from npm carries the reviewed
release identity and exposes compound asset admission plus exact selected-root
retention through the public package boundary.

## Compatibility And Downstream Boundary

This release requires no application or stored-data migration. It changes no
stored asset, page, bundle, descriptor, RootSet, handle, namespace, ref layout,
or reader. Existing repositories and workspace refs open in place. Omitting
`retain` preserves v6.5.9 retain-all behavior.

This witness closes the git-cas publication gate. It does not claim that the
controlled git-warp prototype numbers are released-artifact measurements or
that Think has consumed the release. The next required sequence is git-warp
installing this exact registry artifact, repeating its semantic, migrated-v18,
process-census, CPU, and wall-time gates, publishing its release, and only then
updating Think.
