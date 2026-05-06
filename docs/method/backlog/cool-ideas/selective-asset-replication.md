# COOL IDEA™: Selective Asset Replication

## Context
Currently, moving assets between repositories requires a full `git push` of the vault or manual OID copying.

## Description
Implement a `git-cas sync --slug <slug> --remote <name>` command that calculates the minimal set of chunk blobs and manifest trees required for a specific asset and pushes ONLY those objects to a remote.

## Value
- Enables high-speed replication of specific binaries without synchronizing the entire vault.
- Ideal for distributing specific releases to edge nodes or restricted environments.
- Leverages Git's wire protocol but with "surgical" object selection.
