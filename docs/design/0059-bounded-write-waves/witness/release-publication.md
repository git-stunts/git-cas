# PERF-0059 v6.5.8 Publication Witness

Date: 2026-08-23

Issue: #119

## Immutable Release Identity

- Implementation PR:
  [#120](https://github.com/git-stunts/git-cas/pull/120)
- Release PR: [#121](https://github.com/git-stunts/git-cas/pull/121)
- Reviewed merge commit: `57b40553703b71744c11d6c8e8c62e171683e502`
- Signed annotated tag: `v6.5.8`
- Tag object: `580636bbfd4be622c8247b577708631746175c9a`
- Peeled tag target: `57b40553703b71744c11d6c8e8c62e171683e502`
- Signing key: `01A63D8E9DBEEDE32918AF9C39560E0406CA9135`
- GitHub Release:
  [v6.5.8](https://github.com/git-stunts/git-cas/releases/tag/v6.5.8)
  (final, not a draft or prerelease; published `2026-08-24T04:37:36Z`)

Local `git tag -v v6.5.8` reported a good signature. GitHub independently
reports the annotated tag signature as valid and verified, and both local
peeling and the GitHub tag object resolve to the reviewed release merge
exactly.

## Release Workflow

[Release run 32690361682](https://github.com/git-stunts/git-cas/actions/runs/32690361682)
completed successfully against tag `v6.5.8` and exact commit
`57b40553703b71744c11d6c8e8c62e171683e502`:

| Job            | Result | Evidence                                           |
| -------------- | ------ | -------------------------------------------------- |
| Validate       | pass   | Tag version matched `package.json`                 |
| Test           | pass   | Lint, unit, and Node/Bun/Deno real-Git integration |
| Publish npm    | pass   | OIDC trusted publication completed                 |
| GitHub Release | pass   | Final release created after npm publication        |

Before tagging, the exact reviewed merge passed all 14 release-verifier stages
with 7,057 observed tests, public type compatibility, examples, build stamping,
and npm and JSR dry-runs.

## npm Registry Evidence

Independent registry queries after the workflow completed reported:

| Field         | Value                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Package       | `@git-stunts/git-cas@6.5.8`                                                                       |
| Published     | `2026-08-24T04:37:24.004Z`                                                                        |
| Dist-tag      | `latest` -> `6.5.8`                                                                               |
| Git head      | `57b40553703b71744c11d6c8e8c62e171683e502`                                                        |
| Integrity     | `sha512-Vi4HTS8M29rls0WH/JYXtRTQTrRrDUZUJq+JmvwxGhYrs/D2zu9F3Qbzbj6eOQnVfVOonHFv4oVbF/Q4x6DPNQ==` |
| Shasum        | `d9b1dccdd7c37cc144deca9fb653d12ed97d7ad0`                                                        |
| File count    | `266`                                                                                             |
| Unpacked size | `2,294,644` bytes                                                                                 |
| Tarball       | `https://registry.npmjs.org/@git-stunts/git-cas/-/git-cas-6.5.8.tgz`                              |

The registry exposes the package-version
[attestation endpoint](https://registry.npmjs.org/-/npm/v1/attestations/@git-stunts%2fgit-cas@6.5.8)
with npm publish and `https://slsa.dev/provenance/v1` predicates. The decoded
SLSA statement resolves `refs/tags/v6.5.8` to exact Git commit
`57b40553703b71744c11d6c8e8c62e171683e502` and workflow run `32690361682`.

## Clean-Room Consumer Smoke

A fresh temporary directory with no source-worktree dependency installed the
exact registry package with:

```bash
npm install --no-audit --no-fund @git-stunts/git-cas@6.5.8
```

The installed artifact then reported:

- package version `6.5.8`;
- CLI version `6.5.8+57b4055`;
- embedded build SHA `57b4055`;
- successful ESM root import with 43 public exports;
- successful `@git-stunts/git-cas/service` subpath import; and
- `npm audit signatures` verified registry signatures for all 20 installed
  packages and attestations for 11, with no invalid or missing results.

This proves that the package consumers receive from npm carries the reviewed
release identity, verifies through the registry trust surfaces, and loads
through the documented public package boundaries.

## Downstream Boundary

This witness closes the git-cas publication gate. It does not claim that
git-warp or Think have consumed the release or that their end-to-end latency is
fixed. The next required sequence remains git-warp consuming v6.5.8 and
publishing its measured process census, then Think consuming the released
dependencies.
