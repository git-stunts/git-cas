# git-cas Release Method

Releases happen when externally meaningful behavior changes. Not every cycle is
a release, but every cycle still updates [CHANGELOG.md](../../CHANGELOG.md) and
the root [README.md](../../README.md) when reality changed.

## Before Tagging

All of the following must pass on the release candidate:

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

## Release Flow

1. Finish the cycle and merge it to `main`.
2. Sync local `main` to `origin/main`.
3. Run the full release verification list above on the synced `main`.
4. Mark the changelog entry released.
5. Confirm the root README still reflects shipped reality.
6. Tag the release commit as `vX.Y.Z`.
7. Push the tag.

## Notes

- Do not tag optimistic scope.
- Do not tag before the merged `main` branch proves the release.
- If multiple small cycles together change the external product in a meaningful
  way, release the grouped result honestly.
