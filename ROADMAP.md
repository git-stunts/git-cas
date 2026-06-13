# ROADMAP

`ROADMAP.md` is a signpost into the GitHub tracker.

GitHub Issues and Milestones are the source of truth for work that needs to get
done. This file does not track status, priority, blockers, or completion. It
only explains the release-tracking model and names the intended milestone
sequence so humans and agents know where to look.

## Canonical Tracker

Active work lives in GitHub:

- Milestones own versioned releases: `v6.0.1`, `v6.1.0`, `v6.2.0`, and so on.
- `type:goalpost` issues own release-scale outcomes.
- `type:slice` issues or sub-issues own turn-sized proof work.
- Issue labels and milestone state own active, blocked, review, carried-forward,
  and done status.

Repo docs are supporting records:

- [docs/design/](./docs/design/README.md) holds design contracts and proof plans.
- Design docs link back to the canonical GitHub issue.
- [CHANGELOG.md](./CHANGELOG.md) records shipped release history.
- Archived backlog and goalpost files are historical source material only.

## Current Intended Release Train

The milestones below should exist in GitHub. If this table and GitHub disagree,
GitHub wins and this file should be corrected.

| Milestone | Theme | Tracker |
| --- | --- | --- |
| [`v6.0.1`](https://github.com/git-stunts/git-cas/milestone/1) | Patch closeout and planning truth | [#37](https://github.com/git-stunts/git-cas/issues/37) |
| [`v6.1.0`](https://github.com/git-stunts/git-cas/milestone/2) | Bounded residency and scale hardening | [#38](https://github.com/git-stunts/git-cas/issues/38) |
| [`v6.2.0`](https://github.com/git-stunts/git-cas/milestone/3) | Operator TUI consolidation | [#39](https://github.com/git-stunts/git-cas/issues/39) |
| [`v6.3.0`](https://github.com/git-stunts/git-cas/milestone/4) | Agent automation parity | [#40](https://github.com/git-stunts/git-cas/issues/40) |
| [`v6.4.0`](https://github.com/git-stunts/git-cas/milestone/5) | Browser and edge read-path exploration | [#41](https://github.com/git-stunts/git-cas/issues/41) |
| [`v7.0.0`](https://github.com/git-stunts/git-cas/milestone/6) | Protocol break only if audit requires it | [#42](https://github.com/git-stunts/git-cas/issues/42), only when justified |

## Next Release Design

The next selected design record is:

- [0045-v6-1-bounded-residency](./docs/design/0045-v6-1-bounded-residency/bounded-residency.md)

Its GitHub goalpost issue,
[#38](https://github.com/git-stunts/git-cas/issues/38), is the canonical
tracker. The design doc is the durable contract; the issue is the work item.

Initial `v6.1.0` slice issues:

- [#43 Targeted vault lookup](https://github.com/git-stunts/git-cas/issues/43)
- [#44 Streaming vault list](https://github.com/git-stunts/git-cas/issues/44)
- [#45 Blob read residency contract](https://github.com/git-stunts/git-cas/issues/45)
- [#46 Docs and release evidence](https://github.com/git-stunts/git-cas/issues/46)

## Rule

If it is actionable work, it must be a GitHub Issue. If it only appears in a
Markdown file, it is not tracked work.

Markdown may still preserve:

- design decisions
- evidence and witness records
- release notes
- public documentation
- archived planning source material

Markdown must not be the active queue.
