# COOL IDEA™: Industrial Structured Logging

## Context
`git-cas` uses a custom `ObservabilityPort` but currently only supports human-readable log strings in its standard implementation.

## Description
Implement a `JsonObservabilityAdapter` that emits structured, newline-delimited JSON. This would allow `git-cas` internal events (chunking, encryption, vault updates) to be directly ingested by ELK, Datadog, or Splunk.

## Value
- Critical for enterprise observability.
- Enables automated alerting on vault rotation or integrity failures.
- Standardizes diagnostic output across Node, Bun, and Deno environments.
