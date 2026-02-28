# CLAUDE.md — Project Instructions

## Quality Policy

**Zero tolerance for failing tests.** Pre-existing failures are not acceptable. If any test fails on any supported runtime (Node, Bun, Deno), it must be fixed before proceeding. Never skip, ignore, or defer a failing test.

## Supported Runtimes

All code must pass on all three runtimes:
- Node.js 22.x (primary)
- Bun (via Docker: `docker compose run --build --rm test-bun`)
- Deno (via Docker: `docker compose run --build --rm test-deno`)

## Test Commands

- `npm test` — unit tests (Node)
- `npx eslint .` — lint (0 errors required)
- `docker compose run --build --rm test-bun bunx vitest run test/unit` — Bun unit tests
- `docker compose run --build --rm test-deno deno run -A npm:vitest run test/unit` — Deno unit tests
- `docker compose run --build --rm test-bun bunx vitest run test/integration` — Bun integration tests
- `docker compose run --build --rm test-deno deno run -A npm:vitest run test/integration` — Deno integration tests

## Release Checklist

Before tagging a release, ALL of the following must pass:
1. `npx eslint .` — 0 errors
2. `npm test` — all tests pass (Node)
3. Bun unit + integration tests pass
4. Deno unit + integration tests pass
5. `npm pack --dry-run` — clean
6. `npx jsr publish --dry-run --allow-dirty` — clean
