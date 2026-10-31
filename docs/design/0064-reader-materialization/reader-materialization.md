---
title: "PERF/API - Metadata decoding and optional file materialization"
author: Reader librarian
document_revision: 1
cycle: '0064'
task_id: reader-materialization
legend: API
release_home: none
issue: null
goalpost_issue: null
status: draft
base_commit: 25609d6643c3db344d9e2c61f8e72219c255c9a5
sponsors:
  human: James
  agent: Reader librarian
created: '2026-10-21'
updated: '2026-10-21'
---

# Metadata decoding and optional file materialization

## Linked Issue and Linked Tracker

No new external issue or PR has been created. This is an authorized local
implementation for review, not a claim that work has been shipped or entered
in the GitHub tracker. Existing release and package-split issues are unchanged.

## Design Type and Decision Summary

Two independently usable changes: accelerate default JSON metadata decoding through a runtime adapter,
and add the optional `@git-stunts/git-cas/files` import. The core continues
to return byte streams and buffers. File publication belongs to the caller's
explicit high-level helper invocation.

## Sponsored Human and Sponsored Agent

James requested implementation and explicitly required byte-stream APIs to
remain available. Reader librarian implements the local candidate.

## Hill

A caller can stream one asset into a private temporary file and publish the
complete result with one rename, without changing how existing readers consume
bytes. Repeated JSON metadata conversion should perform less JavaScript work.

## Current Truth and Problem

Bundle lookups repeatedly decode and validate descriptor bytes. Serial corpus
profiling found substantial UTF-8 conversion and allocation cost. Existing
`restoreFile()` stages bounded whole-object restores, but streams other modes
directly into the destination. `assets.open()` has no filesystem destination.

## Scope and Non-Goals

In: infrastructure codec fast path with legacy malformed-byte fallback;
source-agnostic optional materialization; shared existing path validation;
optional full-plaintext SHA-256; cancellation, tests, exports and declarations.

Out: changing byte-stream APIs or legacy restore behavior, a worker pool,
decoded-descriptor caching, encoding/storage changes, automatic cache policy,
durable flush, directory transactions, migration and release publication.

## Runtime / API Contract

The complete [optional file contract](../../API.md#optional-file-materialization-git-stuntsgit-casfiles)
defines source, boundary, destination, cancellation and optional digest. Source
completion must include any required authentication. Rename is the commit
point. The helper waits for stream completion and checks the supplied digest
before publishing. No filename is inferred from stored metadata.

## Accessibility Posture and Lower Modes

The API returns `{ bytesWritten }` and machine-readable errors. Documentation
works as linear plain text and code; there is no visual or TUI dependency.

## Agent Inspectability / Explainability Posture

Tests inspect real destination bytes before and after source completion,
failure, cancellation and digest rejection. Real-Git tests retain access to
the same bytes through the existing APIs. Witnesses distinguish tests from
local timing observations and unrun release checks.

## Linked Invariants

The [architecture](../../../ARCHITECTURE.md) keeps runtime I/O in infrastructure.
Domain services and portable codecs acquire no runtime dependency. Existing encoding,
application handles, manifest validation and source authentication remain intact.

## Design Alternatives Considered and Decision

Changing `assets.open()` to write files would couple byte consumption to a
destination policy. Adding filesystem methods to the domain asset capability
would move that boundary inward. The separate subpath instead consumes any
byte iterator, including an authenticated CAS source. A native decoder in
a runtime adapter preserves the portable JsonCodec and domain decoder as fallback.

## Architecture / Anti-SLUDGE Posture

The helper has no registry, background service, retention system or scheduler.
Only the existing path resolver is shared with legacy file restoration.

## Cost / Residency Posture

The helper honors stream backpressure and writes one temporary file; optional
hashing consumes chunks incrementally. Existing whole-object source buffers
and limits still apply. A caller owns storage quotas and destination lifecycle.
There is no new unbounded metadata cache or automatic CPU pool.

## Git Substrate Impact and Determinism / Replay / Causality

The runtime adapter changes text conversion on read, not encoding. No blob, tree,
manifest, application handle or Git ref format changes. Materialization writes
outside the object store and does not establish retention.

## Compatibility / Migration Posture

Existing root exports and byte APIs remain unchanged. A separate ESM subpath
and declaration file are packaged. Malformed UTF-8 uses the legacy decoder;
BOM preservation prevents silently accepting previously rejected JSON.

## Error Contract

The API reference names invalid options, boundary escape, digest mismatch and
underlying source/filesystem/cancellation errors. Rename is a distinct commit
point: a subsequent cleanup error may be observed after publication. The
original source error is normally propagated through the pipeline.

## Security / Trust / Redaction Posture

Temporary plaintext is held under a private sibling directory, with file
permissions no broader than 0600. Existing realpath confinement is reused.
Directories are trusted local application paths; hostile concurrent directory
replacement is outside this check's guarantee. No key or plaintext is logged.
A crash may leave a private temporary directory; cleanup ownership belongs to
the application.

## User-Facing Text / Directionality

The helper uses existing error codes and short English messages. API docs name
all behavior in text. No localization infrastructure is introduced.

## Proof Surface and Implementation Slices

1. Codec and compatibility tests can land independently of file publication.
2. Optional helper, path extraction, package export, types and docs land together.

## Tests To Write First and Acceptance Criteria

- Unicode, offset-view, BOM and deterministic malformed-byte compatibility.
- Destination remains unchanged while source is incomplete.
- Late source failure, wrong digest, cancellation and failed rename clean up.
- Traversal and symlink escape are rejected before source consumption.
- Plain/whole/framed/convergent real-Git sources materialize correctly.
- Existing asset streams, manifest streams and manifest buffers still work.
- Public declarations compile and packaged exports contain the helper.

## Validation Plan and Playback / Witness

Use the existing Docker test images and reusable worker under its workstation
lock. Run focused RED/GREEN, lint, the Node unit chain, and relevant real-Git
tests on Node, Bun and Deno. Preserve commands and outcomes in `witness/`;
do not confuse an isolated passing assertion with full project acceptance.

## Risks and Follow-On Debt

Native decoder behavior needs cross-runtime checks. Performance observations
are local and cache-influenced, not latency guarantees. Crash recovery,
durable sync and concurrent hostile path mutation remain explicit exclusions.

## Tracker Disposition and Done Does Not Mean

Local commits do not mean a GitHub issue, PR, merge, release or Reader migration.
No unpublished result should be described as shipped behavior.

## Retrospective

Record actual checks and remaining boundaries in the witness before handoff.
