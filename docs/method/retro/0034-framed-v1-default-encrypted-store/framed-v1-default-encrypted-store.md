# Retro — 0034 Framed-v1 Default Encrypted Store

## Drift Check

- The cycle stayed on default-write behavior and its user-facing docs.
- It did not reopen restore-path mechanics or encryption runtime parity work.
- It kept `whole-v1` as a supported compatibility mode instead of trying to
  remove it.

## What Shipped

- New encrypted stores now default to `framed-v1` instead of `whole-v1`.
- `encryption.frameBytes` now works without explicitly spelling out
  `scheme: 'framed-v1'`.
- Recipient/envelope stores follow the same default and now emit framed
  metadata unless `whole-v1` is requested explicitly.
- Public docs now describe `framed-v1` as the normal encrypted-write path and
  `whole-v1` as the explicit compatibility opt-out.

## What Did Not

- Existing `whole-v1` restore behavior did not change.
- This cycle did not make `whole-v1` true streaming or remove its
  compatibility role.
- CLI ergonomics beyond doc truth were not reopened.

## Debt

- None added. The next obvious follow-on remains service decomposition or agent
  CLI parity from the existing backlog.

## Cool Ideas

- If the repo ever wants a stronger migration story, it could emit an explicit
  observability metric when callers opt into `whole-v1` so compatibility usage
  can be measured before any future retirement discussion.
