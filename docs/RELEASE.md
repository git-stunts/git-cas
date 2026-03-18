# Release Workflow

This document defines the canonical patch-release flow for `git-cas`.

## Patch Release Flow

1. Branch from `main`.
2. Bump the in-flight version in `package.json` and `jsr.json`.
3. Add a new unreleased section to `CHANGELOG.md`.
4. Run `pnpm release:verify`.
5. Open a pull request and wait for review.
6. Merge to `main`.
7. Sync local `main` to `origin/main`.
8. Run `pnpm release:verify` again on `main`.
9. Finalize release-facing docs:
   - mark the changelog entry released
   - update the lead README “What’s new” section
   - update `STATUS.md` and `ROADMAP.md`
10. Create and push the tag (`vX.Y.Z`).

## Release Verification

`pnpm release:verify` is the maintainer-facing verification entrypoint for
release prep. It runs the repository release gates in order and prints a
Markdown summary that can be pasted into release notes or changelog prep. Pass
`--json` when you need the same report in machine-readable form for CI or
release automation.

Current release verification includes:

- `pnpm run lint`
- `pnpm test`
- `docker compose run --build --rm test-bun bunx vitest run test/unit`
- `docker compose run --build --rm test-deno deno run -A npm:vitest run test/unit`
- `pnpm run test:integration:node`
- `pnpm run test:integration:bun`
- `pnpm run test:integration:deno`
- `npm pack --dry-run`
- `npx jsr publish --dry-run --allow-dirty`

The helper is intentionally read-only with respect to release notes. It does
not edit `CHANGELOG.md`; it only prints a summary block for maintainers.

## Release Notes Discipline

- Treat release tags as immutable.
- Do not tag until the merged `main` branch passes release verification.
- If any runtime fails, fix the underlying problem before tagging.
