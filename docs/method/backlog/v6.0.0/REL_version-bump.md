# REL: Version bump and release checklist

## What

Bump to 6.0.0, tag, push, let CI publish.

## Steps

1. Bump version in `package.json` and `jsr.json` to `6.0.0`
2. Update `CHANGELOG.md` with final v6.0.0 section
3. Commit: `chore: bump to v6.0.0`
4. Push to main
5. Tag: `git tag -a v6.0.0 -m "v6.0.0 — convergent encryption, scheme simplification, security hardening"`
6. Push tag: `git push origin v6.0.0`
7. CI handles: validate → test (Node/Bun/Deno) → publish npm (OIDC) + JSR (OIDC) → GitHub Release

## Release Checklist (from CLAUDE.md)

- [ ] `npx eslint .` — 0 errors
- [ ] `npm test` — all tests pass (Node)
- [ ] Bun unit + integration tests pass
- [ ] Deno unit + integration tests pass
- [ ] `npm pack --dry-run` — clean
- [ ] `npx jsr publish --dry-run --allow-dirty` — clean
- [ ] CHANGELOG complete
- [ ] UPGRADING.md exists and is linked from README
- [ ] Migration script works (`npm run upgrade`)
- [ ] Tag is annotated (not lightweight)

## Blocked By

- REL_migration-script
- REL_breaking-changes-doc
- REL_docs-accuracy-audit
- REL_signpost-rewrite
