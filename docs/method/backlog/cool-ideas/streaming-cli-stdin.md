# COOL IDEA™: Streaming CLI (stdin)

## Context
The `git-cas store` command currently requires a file path on disk.

## Description
Add support for reading from `stdin` when the filename is `-`.
Example: `cat large-dump.sql | git-cas store - --slug db/nightly`

## Value
- Allows piping output from other tools (backups, logs, build artifacts) directly into CAS.
- Reduces disk I/O and temporary space requirements.
- Makes `git-cas` a better "Unix citizen" in pipeline workflows.
