# API-0047 v6.2.0 Publication Witness

Date: 2026-07-13

Issues: #50, #60

## Immutable Release Identity

- Release PR: [#67](https://github.com/git-stunts/git-cas/pull/67)
- Reviewed merge commit: `432c5d9effb12c9f66536f1386791bb4421f3cea`
- Signed annotated tag: `v6.2.0`
- Tag object: `dce2d39b62bf56a7558f99ba6061934665b0ef30`
- Peeled tag target: `432c5d9effb12c9f66536f1386791bb4421f3cea`
- Signing key: `01A63D8E9DBEEDE32918AF9C39560E0406CA9135`
- GitHub Release:
  [v6.2.0](https://github.com/git-stunts/git-cas/releases/tag/v6.2.0)
  (final, not a draft or prerelease; published `2026-07-13T20:08:30Z`)

Local `git tag -v v6.2.0` reported a good signature, and the remote peeled tag
target matches the reviewed merge commit exactly.

## Release Workflow

[Release run 29280878104](https://github.com/git-stunts/git-cas/actions/runs/29280878104)
completed successfully against `v6.2.0`:

| Job | Result | Evidence |
| --- | --- | --- |
| Validate | pass | Tag version matched `package.json` |
| Test | pass | Lint, unit, Node/Bun/Deno real-Git integration |
| Publish npm | pass | OIDC trusted publication completed |
| GitHub Release | pass | Final release created after npm publication |

Before tagging, `pnpm run release:verify` also passed all 13 steps on merged
`main` at `432c5d9`, observing 6,124 tests and completing the npm package
dry-run and the JSR publication dry-run.

## npm Registry Evidence

Independent registry queries after the workflow completed reported:

| Field | Value |
| --- | --- |
| Package | `@git-stunts/git-cas@6.2.0` |
| Published | `2026-07-13T20:08:19.903Z` |
| Dist-tag | `latest` -> `6.2.0` |
| Integrity | `sha512-m8+ZzgNhKU6pVS9pjqJlwAnwYI/s+NMEnINC+Q0g3h6T6mNPdH8U0jb4nEoxU9N1TF+Ut5bjtRMRRaYT75dlew==` |
| Shasum | `a8e14f3b8fadd382862622ccf3b0a895892f4121` |
| Unpacked size | `2,004,586` bytes |
| Tarball | `https://registry.npmjs.org/@git-stunts/git-cas/-/git-cas-6.2.0.tgz` |

The registry exposes the package-version
[attestation endpoint](https://registry.npmjs.org/-/npm/v1/attestations/@git-stunts%2fgit-cas@6.2.0)
and reports provenance predicate type `https://slsa.dev/provenance/v1`.

## Downstream Gate

The registry artifact now satisfies the dependency gate for git-warp. That
repository must consume the published `6.2.0` package through its normal
package manager; it must not use a local path override to bypass release
evidence.

JSR publication was not claimed or attempted. Its dry-run is healthy, but npm
and GitHub Releases are the v6.2.0 publication surfaces.
