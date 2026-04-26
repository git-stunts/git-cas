# RL — Relay

## Covers

The machine-facing `git cas agent` contract, protocol behavior, and the
boundary work required so later human-surface work can reuse a clean core.

## Who Cares

- maintainers
- release engineers
- CI or backup workflows
- coding agents that need deterministic machine contracts

## Success Looks Like

An agent can perform core `git-cas` workflows through a stable, explicit,
non-interactive contract without scraping human prose or depending on TTY
behavior.

## How We Know

- the protocol is documented and testable
- machine-facing commands emit explicit records and exit codes
- human and agent surfaces stay separate over one shared core

## Current Backlog

- none currently

## Historical Context

Relay cycle history remains in the legacy design and archive surfaces:

- [docs/design/README.md](../../design/README.md)
- [legacy RL legend surface](../../legends/RL-relay.md)
