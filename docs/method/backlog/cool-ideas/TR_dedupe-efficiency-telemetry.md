# COOL IDEA™: CAS Health & Dedupe Telemetry

## Context
Deduplication is a core feature of `git-cas`, but users currently have no visibility into how effective it is over time.

## Description
Add a background "Health & Efficiency" reporter that calculates the unique chunk count vs total logical bytes stored. Expose this via a `git-cas vault health` command that returns a "Efficiency Score" (1-100).

## Value
- Provides concrete ROI metrics for storage cost savings.
- Helps identify when rolling hash parameters should be adjusted.
- Gamifies repository maintenance for developers.
