# Witness — Adopt METHOD

This witness records the concrete evidence for cycle
`0020-method-adoption`.

## Human Playback

### Question

Can a maintainer find the active backlog, release process, and current cycle
directory without reading the legacy backlog or legend docs first?

### Answer

Yes.

### Evidence

- [WORKFLOW.md](../../../../WORKFLOW.md) points directly to
  [docs/method/process.md](../../../method/process.md)
- [docs/RELEASE.md](../../../RELEASE.md) points directly to
  [docs/method/release.md](../../../method/release.md)
- [docs/method/backlog/README.md](../../../method/backlog/README.md)
  lists the live lanes and current items
- [docs/design/README.md](../../README.md) identifies the active cycle directory

## Agent Playback

### Question

Can an agent inspect the filesystem and identify the active METHOD backlog,
legend, cycle, witness, and retro locations without relying on repo lore?

### Answer

Yes.

### Evidence

- `ls docs/method/backlog`
- `ls docs/method/legends`
- `ls docs/design/0020-method-adoption`
- `ls docs/design/0020-method-adoption/witness`
- `ls docs/method/retro`

## Observed Verification

The following checks passed during this cycle:

- `npx prettier --check` on the touched Markdown files
- `git diff --check`
- `npx eslint .`
- `npm test`
- `docker compose run --build --rm test-node npx vitest run test/integration`
- Bun unit and integration tests
- Deno unit and integration tests

Concrete runtime commands run:

- `docker compose run --build --rm test-bun bunx vitest run test/unit`
- `docker compose run --build --rm test-bun bunx vitest run test/integration`
- `docker compose run --build --rm test-deno deno run -A npm:vitest run test/unit`
- `docker compose run --build --rm test-deno deno run -A npm:vitest run test/integration`
