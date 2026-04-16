# TR — Framed-v1 Default Encrypted Store

## Why This Exists

`framed-v1` is now the honest authenticated streaming encryption mode, but new
encrypted stores still default to `whole-v1` compatibility behavior unless the
caller opts in explicitly.

That leaves the best streaming behavior available but not default.

## Target Outcome

Design and land a migration to make `framed-v1` the default for new encrypted
stores while:

- keeping `whole-v1` restore compatibility for existing manifests
- documenting the behavior change clearly for CLI and library users
- making any opt-out path to `whole-v1` explicit instead of accidental

## Human Value

Users should get the more scalable encrypted restore path by default instead of
having to already know the format tradeoff.

## Agent Value

Agents should be able to recommend encrypted stores without immediately having
to add a format-selection footnote for normal cases.

## Notes

- separate default-write behavior from restore compatibility
- coordinate CLI examples, README, and API docs with the migration
