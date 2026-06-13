# ROADMAP

`ROADMAP.md` is the release-line index for upcoming `git-cas` work.

Active implementation still follows the METHOD loop in
[docs/method/process.md](./docs/method/process.md): goalposts are planned here,
pulled into numbered design cycles, proven with tests and witnesses, and shipped
through one pull request per goalpost.

## Reading Order

1. Start here for release sequencing.
2. Open the release goalpost docs under [docs/goalposts/](./docs/goalposts/).
3. Use [docs/design/](./docs/design/README.md) for cycle-level contracts and
   proof plans.
4. Use [docs/method/backlog/](./docs/method/backlog/README.md) for uncommitted
   debt and ideas that have not yet become release goalposts.

## Current State

- **Last tagged release:** `v6.0.0` (`2026-05-09`)
- **Current branch:** `main`
- **Current release line:** `v6.x`
- **Supported runtimes:** Node.js 22.x, Bun, Deno
- **Publication surfaces:** npm and GitHub Releases are active; JSR publication
  remains deferred until the upstream dry-run blocker is healthy.
- **Planning posture:** `asap/` and `up-next/` are empty. The next product work
  is selected from active debt, release truth, and v6.x operator goals.

## Release Train

| Release | Theme | Required goalposts | Status |
| --- | --- | --- | --- |
| `v6.0.1` | Patch closeout and planning truth | [Release Truth Closeout](./docs/goalposts/v6.0.1/release-truth-closeout.md) | scaffolded |
| `v6.1.0` | Bounded residency and scale hardening | [Bounded Residency](./docs/goalposts/v6.1.0/bounded-residency.md) | scaffolded |
| `v6.2.0` | Operator TUI consolidation | [Operator TUI](./docs/goalposts/v6.2.0/operator-tui.md) | planned |
| `v6.3.0` | Agent automation parity | [Agent Automation Parity](./docs/goalposts/v6.3.0/agent-automation-parity.md) | planned |
| `v6.4.0` | Browser and edge read-path exploration | [Browser/Edge Read Path](./docs/goalposts/v6.4.0/browser-edge-read-path.md) | planned |
| `v7.0.0` | Protocol break only if audit requires it | [Protocol Audit Response](./docs/goalposts/v7.0.0/protocol-audit-response.md) | provisional |

## Next Release: `v6.1.0`

`v6.1.0` should make the core bounded under large vault and large blob
conditions. The target is not a new user-visible feature; it is a stronger
residency contract for the storage surfaces that already exist.

Goalpost:

- [Bounded Residency](./docs/goalposts/v6.1.0/bounded-residency.md)

Design:

- [0045-v6-1-bounded-residency](./docs/design/0045-v6-1-bounded-residency/bounded-residency.md)

Required proof:

- large-vault slug resolution does not materialize the entire vault tree
- vault listing uses the streaming tree path when the adapter provides it
- metadata-sized blob reads remain guarded
- domain data reads prefer `readBlobStream()` for unbounded payloads
- docs and release evidence describe the bounded-residency contract honestly

## Goalpost Rules

- A goalpost is a release-scale feature or invariant.
- Goalposts are subdivided into turn-sized slices.
- One pull request should carry one goalpost.
- Each slice needs an expected proof: test, fixture, witness, schema, runtime
  behavior, docs update, or issue update.
- Goalposts do not replace design cycles. A design cycle is how a goalpost
  becomes implementable work.
- Goalposts may start with `not opened yet` issue fields. They should be linked
  to GitHub issues before implementation begins.

## Templates

- [Goalpost template](./docs/templates/goalpost.md)
- [Design doc template](./docs/templates/design-doc.md)

## Release Gates

Every release still follows [docs/method/release.md](./docs/method/release.md).
The default local release evidence command is:

```bash
npm run release:verify -- --skip-jsr
```

Use `--skip-jsr` only while the documented upstream JSR/Deno blocker remains
outside this repo. When the dry-run is healthy, full release verification should
include JSR again.

## Not A Roadmap Item

`v7.0.0` is not a general cleanup bucket. It becomes real only if protocol,
storage, migration, or public API evidence requires a breaking change.
