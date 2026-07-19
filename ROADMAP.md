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

| Milestone                                                      | Theme                                                       | Tracker                                                                                                                                                                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`v6.0.1`](https://github.com/git-stunts/git-cas/milestone/1)  | Patch closeout and planning truth                           | [#37](https://github.com/git-stunts/git-cas/issues/37)                                                                                                                                                                         |
| [`v6.1.0`](https://github.com/git-stunts/git-cas/milestone/2)  | Bounded residency and scale hardening                       | [#43](https://github.com/git-stunts/git-cas/issues/43), [#44](https://github.com/git-stunts/git-cas/issues/44), [#45](https://github.com/git-stunts/git-cas/issues/45), [#48](https://github.com/git-stunts/git-cas/issues/48) |
| [`v6.2.0`](https://github.com/git-stunts/git-cas/milestone/3)  | Emergency application storage and cache ownership boundary  | [#50](https://github.com/git-stunts/git-cas/issues/50)                                                                                                                                                                         |
| [`v6.3.0`](https://github.com/git-stunts/git-cas/milestone/7)  | Bounded scoped cache acquisitions                           | [#69](https://github.com/git-stunts/git-cas/issues/69), [#70](https://github.com/git-stunts/git-cas/issues/70)                                                                                                                 |
| [`v6.4.0`](https://github.com/git-stunts/git-cas/milestone/4)  | Scoped staging workspaces                                   | [#75](https://github.com/git-stunts/git-cas/issues/75), [#77](https://github.com/git-stunts/git-cas/issues/77)                                                                                                                 |
| [`v6.4.1`](https://github.com/git-stunts/git-cas/milestone/8)  | Historical bounded-residency proof closeout                 | [#38](https://github.com/git-stunts/git-cas/issues/38), [#46](https://github.com/git-stunts/git-cas/issues/46)                                                                                                                 |
| [`v6.5.0`](https://github.com/git-stunts/git-cas/milestone/5)  | Bounded lazy bundle references and immutable metadata reads | [#81](https://github.com/git-stunts/git-cas/issues/81)                                                                                                                                                                         |
| [`v6.5.1`](https://github.com/git-stunts/git-cas/milestone/11) | Bounded immutable page payload reuse                        | [#85](https://github.com/git-stunts/git-cas/issues/85)                                                                                                                                                                         |
| [`v6.5.2`](https://github.com/git-stunts/git-cas/milestone/12) | Persistent bounded Git object sessions                      | [#90](https://github.com/git-stunts/git-cas/issues/90)                                                                                                                                                                         |
| [`v6.6.0`](https://github.com/git-stunts/git-cas/milestone/9)  | Operator TUI and agent automation follow-through            | [#39](https://github.com/git-stunts/git-cas/issues/39), [#40](https://github.com/git-stunts/git-cas/issues/40)                                                                                                                 |
| [`v6.7.0`](https://github.com/git-stunts/git-cas/milestone/10) | Browser and edge read-path exploration                      | [#41](https://github.com/git-stunts/git-cas/issues/41)                                                                                                                                                                         |
| [`v7.0.0`](https://github.com/git-stunts/git-cas/milestone/6)  | Protocol break only if audit requires it                    | [#42](https://github.com/git-stunts/git-cas/issues/42), only when justified                                                                                                                                                    |

## Latest Landed Design

The latest landed design record is:

- [0052-persistent-git-object-sessions](./docs/design/0052-persistent-git-object-sessions/persistent-git-object-sessions.md)

Its GitHub goalpost issue,
[#90](https://github.com/git-stunts/git-cas/issues/90), owns the release
evidence. The design doc is the durable contract; GitHub records completion.

The `v6.2.0` slice record is:

- [#54 Opaque asset handles and retention witnesses](https://github.com/git-stunts/git-cas/issues/54)
- [#51 Structured bundle and Merkle page storage](https://github.com/git-stunts/git-cas/issues/51)
- [#59 RootSet-backed CacheSet lifecycle](https://github.com/git-stunts/git-cas/issues/59)
- [#53 Expiry-safe replay set](https://github.com/git-stunts/git-cas/issues/53)
- [#55 Repository and cache usage diagnostics](https://github.com/git-stunts/git-cas/issues/55)
- [#49 Repository-wide reachability classification](https://github.com/git-stunts/git-cas/issues/49)
- [#60 v6.2.0 release evidence](https://github.com/git-stunts/git-cas/issues/60)

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
