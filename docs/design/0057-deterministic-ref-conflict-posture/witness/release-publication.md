# TRUST-0057 v6.5.6 Publication Witness

Date: 2026-07-30

Issue: #111

## Immutable Release Identity

- Implementation PRs:
  [#109](https://github.com/git-stunts/git-cas/pull/109) and
  [#112](https://github.com/git-stunts/git-cas/pull/112)
- Release PR: [#113](https://github.com/git-stunts/git-cas/pull/113)
- Reviewed merge commit: `257e8821ddb971bb922d618b7944da07a987e6c4`
- Signed annotated tag: `v6.5.6`
- Tag object: `248f3c740348e019cc0a4fb0ce8d5457dba824e2`
- Peeled tag target: `257e8821ddb971bb922d618b7944da07a987e6c4`
- Signing key: `01A63D8E9DBEEDE32918AF9C39560E0406CA9135`
- GitHub Release:
  [v6.5.6](https://github.com/git-stunts/git-cas/releases/tag/v6.5.6)
  (final, not a draft or prerelease; published `2026-07-30T08:26:15Z`)

Local `git tag -v v6.5.6` reported a good signature. GitHub independently
reports the annotated tag signature as verified and the tag peels to the
reviewed release merge exactly.

## Release Workflow

[Release run 30526282895](https://github.com/git-stunts/git-cas/actions/runs/30526282895)
completed successfully against `v6.5.6`:

| Job | Result | Evidence |
| --- | --- | --- |
| Validate | pass | Tag version matched `package.json` |
| Test | pass | Lint, unit, Node/Bun/Deno real-Git integration |
| Publish npm | pass | OIDC trusted publication completed |
| GitHub Release | pass | Final release created after npm publication |

Before tagging, reviewed merge `257e8821` passed all 14 verifier steps with
6,898 observed tests, public type compatibility, examples, build stamping, and
npm and JSR dry-runs.

## npm Registry Evidence

Independent registry queries after the workflow completed reported:

| Field | Value |
| --- | --- |
| Package | `@git-stunts/git-cas@6.5.6` |
| Published | `2026-07-30T08:25:59.406Z` |
| Dist-tag | `latest` -> `6.5.6` |
| Integrity | `sha512-pv2RSJsTpcGxiNTfxpYhripL3ievxQEgUICj5iOiIU6HV8nTs71/N1nPWr45wMNJpEJmoxzuMZw/JjAwwYJgTQ==` |
| Shasum | `08dfdf7a217dcd06a465d38dc8692ae4b220083d` |
| File count | `257` |
| Unpacked size | `2,218,118` bytes |
| Tarball | `https://registry.npmjs.org/@git-stunts/git-cas/-/git-cas-6.5.6.tgz` |

The registry exposes the package-version
[attestation endpoint](https://registry.npmjs.org/-/npm/v1/attestations/@git-stunts%2fgit-cas@6.5.6)
with npm publish and `https://slsa.dev/provenance/v1` predicates.
