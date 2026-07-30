# INFRA-0055 v6.5.5 Publication Witness

Date: 2026-07-26

Issue: #102

## Immutable Release Identity

- Implementation PR: [#103](https://github.com/git-stunts/git-cas/pull/103)
- Release PR: [#104](https://github.com/git-stunts/git-cas/pull/104)
- Reviewed merge commit: `9ea91a738f2cbadf2a20b5ac7c2c6d54ba9f409e`
- Signed annotated tag: `v6.5.5`
- Tag object: `c1dc40fa3b25902be4abf6588da75f309a0153c7`
- Peeled tag target: `9ea91a738f2cbadf2a20b5ac7c2c6d54ba9f409e`
- Signing key: `01A63D8E9DBEEDE32918AF9C39560E0406CA9135`
- GitHub Release:
  [v6.5.5](https://github.com/git-stunts/git-cas/releases/tag/v6.5.5)
  (final, not a draft or prerelease; published `2026-07-26T17:04:28Z`)

Local `git tag -v v6.5.5` reported a good signature. The tag peels to the
reviewed release merge exactly.

## Release Workflow

[Release run 30211630524](https://github.com/git-stunts/git-cas/actions/runs/30211630524)
completed successfully against `v6.5.5`:

| Job | Result | Evidence |
| --- | --- | --- |
| Validate | pass | Tag version matched `package.json` |
| Test | pass | Lint, unit, Node/Bun/Deno real-Git integration |
| Publish npm | pass | OIDC trusted publication completed |
| GitHub Release | pass | Final release created after npm publication |

Before tagging, the release candidate passed all 14 verifier steps with 6,850
observed tests, public type compatibility, examples, build stamping, and npm
and JSR dry-runs.

## npm Registry Evidence

Independent registry queries after the workflow completed reported:

| Field | Value |
| --- | --- |
| Package | `@git-stunts/git-cas@6.5.5` |
| Published | `2026-07-26T17:04:16.205Z` |
| Dist-tag at publication | `latest` -> `6.5.5` |
| Integrity | `sha512-x2ohvIq04o5W3eFmn/x6WQ8UuXcqIxcdKuQOhttZJ80ZokuY+97xqqi7cJCDdrmeJMkbcuSW1VvWFzcz6K6TAg==` |
| Shasum | `92d2be5d262dd8f24273d518d60bb23f81d7d427` |
| File count | `256` |
| Unpacked size | `2,213,032` bytes |
| Tarball | `https://registry.npmjs.org/@git-stunts/git-cas/-/git-cas-6.5.5.tgz` |

The registry exposes the package-version
[attestation endpoint](https://registry.npmjs.org/-/npm/v1/attestations/@git-stunts%2fgit-cas@6.5.5)
with npm publish and `https://slsa.dev/provenance/v1` predicates.
