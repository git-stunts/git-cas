# REL: Version bump and release checklist

## What

Bump to 6.0.0, finish local release gates, then tag, push, and let CI publish
after operator approval.

## Steps

1. Bump version in `package.json` and `jsr.json` to `6.0.0`
2. Update `CHANGELOG.md` with final v6.0.0 section
3. Commit release-gate cleanup
4. Push/merge to main after review
5. Tag: `git tag -a v6.0.0 -m "v6.0.0 — convergent encryption, scheme simplification, security hardening"`
6. Push tag: `git push origin v6.0.0`
7. CI handles: validate → test (Node/Bun/Deno) → publish npm (OIDC) + JSR (OIDC) → GitHub Release

## Release Checklist (from CLAUDE.md)

- [x] `npx eslint .` — 0 errors
- [x] `npm test` — all tests pass (Node)
- [x] Bun unit + integration tests pass
- [x] Deno unit + integration tests pass
- [x] `npm pack --dry-run` — clean
- [ ] `npx jsr publish --dry-run --allow-dirty` — **BLOCKED** by upstream Deno 2.6.7 panic in `deno_ast@0.52.0` (also fails on `main`; not a v6 regression). JSR publish deferred until Deno fix lands.
- [x] CHANGELOG complete
- [x] UPGRADING.md exists and is linked from README
- [x] Migration script works (`npm run upgrade`)
- [ ] Tag is annotated (not lightweight)

## Evidence

- `npx eslint .` passed on 2026-05-04.
- `npm test` passed on 2026-05-04: 119 files, 1341 passed, 2 skipped.
- Node integration passed on 2026-05-04: 4 files, 152 passed.
- Bun unit passed on 2026-05-04: 118 files passed, 1 file skipped; 1360 passed, 6 skipped.
- Bun integration passed on 2026-05-04: 4 files, 152 passed.
- Deno unit passed on 2026-05-04: 118 files passed, 1 file skipped; 1329 passed, 14 skipped.
- Deno integration passed on 2026-05-04: 4 files, 152 passed.
- `test/unit/docs/guide-examples.test.js` and `test/unit/docs/markdown-links.test.js`
  now cover the `GUIDE.md` example proof and tracked Markdown link audit in a
  full checkout; package Docker images skip file-audit assertions because
  `.dockerignore` excludes `.git` and most Markdown.
- `npm run upgrade` passed on 2026-05-04 in dry-run mode; no local vault found.
- `npm pack --dry-run` passed on 2026-05-04 for `@git-stunts/git-cas@6.0.0`; tarball has 102 files and package size 193.3 kB.
- `npx jsr publish --dry-run --allow-dirty` still fails before package validation completes because `jsr@0.14.2` invokes its downloaded Deno 2.6.7 binary and panics in `deno_ast@0.52.0` with overlapping text changes.

## Remaining Before Tag

- Decide how to handle the external JSR dry-run blocker before publishing to JSR.
- Land the release branch, create an annotated `v6.0.0` tag, and push the tag.
