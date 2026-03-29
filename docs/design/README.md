# Design Docs

This directory holds pre-implementation design docs for `git-cas`.

The working rules are simple:

- design docs come first
- executable tests come second
- implementation comes third
- `main` is the playback truth

New cycle docs should follow the workflow in [WORKFLOW.md](../../WORKFLOW.md)
and use legend-code naming:

`<Legend code>-<numerical identifier>-<name>.md`

The existing `0001`/`0002`/`0003` docs are legacy cycle docs from before that
naming migration and can remain until they are touched.

Current design docs:

- [0001 — M18 Relay: Agent CLI Foundation](./0001-m18-relay-agent-cli.md)
- [0002 — M18 Relay: Write Flows and Input Semantics](./0002-m18-relay-write-flows.md)
- [0003 — M18 Relay: Tree Creation Primitive](./0003-m18-relay-tree-creation.md)
- [RL-001 — Relay: Agent Recipient List](./RL-001-agent-recipient-list.md)
- [RL-002 — Relay: Agent Recipient Mutations](./RL-002-agent-recipient-mutations.md)
- [RL-003 — Relay: Agent Rotate](./RL-003-agent-rotate.md)
- [RL-004 — Relay: Agent Vault Rotate](./RL-004-agent-vault-rotate.md)
- [RL-005 — Relay: Agent Vault Lifecycle](./RL-005-agent-vault-lifecycle.md)
- [TR-001 — Truth: Architecture Reality Gap](./TR-001-architecture-reality-gap.md)
