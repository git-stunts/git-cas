# Cool Idea: Wire OperationFeed as a dashboard drawer

## What
The OperationFeed block exists but has no dashboard consumer. Add an `o` keybinding to open a persistent operation log drawer showing store/restore history with status, duration, and chunk progress.

## Why
The toast system is transient — operations disappear after a few seconds. The feed provides a persistent audit trail of what happened during the session. Useful for operators running multiple store operations.

## Sketch
1. Add `operationFeed` state to DashModel (OperationFeedState)
2. Add `o` keybinding → toggle operation feed drawer
3. Wire store wizard completion into `feedStartOp` / `feedCompleteOp` / `feedFailOp`
4. Render via `renderOperationFeed` in a right-side drawer
