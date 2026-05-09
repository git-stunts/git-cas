# git-cas Release Method

Releases happen when externally meaningful behavior changes. Not every cycle is
a release, but every cycle still updates [CHANGELOG.md](../../CHANGELOG.md) and
the root [README.md](../../README.md) when reality changed.

## Before Tagging

All of the following must pass on the release candidate. Prefer
`npm run release:verify` so the release record comes from one command.

1. `npx eslint .`
2. `npm test`
3. `docker compose run --build --rm test-node npx vitest run test/integration`
4. `docker compose run --build --rm test-bun bunx vitest run test/unit`
5. `docker compose run --build --rm test-bun bunx vitest run test/integration`
6. `docker compose run --build --rm test-deno deno run -A npm:vitest run test/unit`
7. `docker compose run --build --rm test-deno deno run -A npm:vitest run test/integration`
8. `npm pack --dry-run`
9. `npx jsr publish --dry-run --allow-dirty`

Zero tolerance applies here. If any runtime fails, fix the underlying problem
before continuing.

JSR is the only gate that may be deferred, and only for a documented upstream
toolchain failure that prevents package validation from starting. In that case,
run `npm run release:verify -- --skip-jsr`, record the skipped step in the
release backlog evidence, and keep JSR publication out of the tag workflow
until the dry-run is healthy again.

## Release Flow

1. Finish the cycle and merge it to `main`.
2. Sync local `main` to `origin/main`.
3. Run the full release verification list above on the synced `main`.
4. Mark the changelog entry released.
5. Confirm the root README still reflects shipped reality.
6. Tag the release commit as `vX.Y.Z`.
7. Push the tag.

If the tag workflow fails after the tag exists, do not move or recreate the tag.
Fix the workflow on `main`, then run the Release workflow manually with
`release_ref` set to the existing `vX.Y.Z` tag. The manual workflow checks out
that tag before validation, tests, npm publication, and GitHub Release creation.

## Notes

- Do not tag optimistic scope.
- Do not tag before the merged `main` branch proves the release.
- If multiple small cycles together change the external product in a meaningful
  way, release the grouped result honestly.
