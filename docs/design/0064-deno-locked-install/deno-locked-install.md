---
title: "INFRA-159 - Reproducible Deno dependency installation"
cycle: "0064"
task_id: "deno-locked-install"
legend: "INFRA"
release_home: "v7.1.0"
issue: "https://github.com/git-stunts/git-cas/issues/159"
goalpost_issue: "none"
tracker_source: "github"
status: "active"
base_commit: "ae3a81cddf5f45a54a676c62bdb0335db77da5a0"
owners: ["@git-stunts"]
sponsors:
  human: "James"
  agent: "Codex"
blocking_issues: []
supersedes: []
superseded_by: null
created: "2026-11-02"
updated: "2026-11-02"
---

# Reproducible Deno dependency installation

## Linked Issue

[#159](https://github.com/git-stunts/git-cas/issues/159).

## Linked Tracker

[v7.1.0](https://github.com/git-stunts/git-cas/milestone/25). Independently
mergeable tooling repair; the runtime gate must pass before that release.

## Design Type

Test/tooling. Agent surface first.

## Decision Summary

Install the Deno test image's dependencies with the existing pnpm lock and
`--frozen-lockfile`, then run Deno against that local graph in manual mode.
Remove the speculative ignored install and second unlocked Deno install.

## Sponsored Human

James needs a supported-runtime result that reaches tests even when an upstream
optional dependency release is incomplete.

## Sponsored Agent

Codex needs one inspectable install graph and a failing install exit status,
without guessing whether a fresh resolver selected different transitive versions.

## Hill

The Deno image builds and its actual unit, integration and declaration commands
pass with dependencies selected by `pnpm-lock.yaml`.

## Current Truth

The repaired Deno stage in `Dockerfile` installs `pnpm@10`, copies `package.json`
and `pnpm-lock.yaml`, and runs `pnpm install --frozen-lockfile` before copying
source. Deno runs the installed graph with explicit manual node_modules mode.

The baseline stage copied only `package.json`, attempted an ignored
`deno install --allow-scripts`, copied source, then repeated that unlocked install.
The [CI job at 13:50 UTC](https://github.com/git-stunts/git-cas/actions/runs/41456162064/job/125314087172)
failed before tests because `@cbor-extract/cbor-extract-win32-x64@2.2.3` was absent.
The committed pnpm graph selects `cbor-extract@2.2.0`. Node already installs that
graph with the frozen-lock flag. Both declaration configurations already use
manual node_modules mode.

The registry published that missing version at 13:57:25 UTC on 2026-11-02.
The first local baseline install therefore succeeded, selecting newer versions
including `cbor-extract@2.2.3` and `cbor-x@1.6.9` instead of the committed graph.
Preserve the historical hosted failure and successful local baseline separately.
The reproducible regression is graph drift, not a claim that the package remains
missing after publication.

## Problem

The baseline Deno build could resolve a different dependency graph on a fresh
install and fail before evaluating any CAS code. Its first ignored install also
concealed an error that the second command then repeated.

## Scope

Deno Docker installation, explicit runtime invocation mode, operator guidance,
and concrete clean-install/runtime evidence.

## Non-Goals

No reservation implementation, dependency range change, package API change,
runtime upgrade, Bun lock migration or ignored nonzero installer/test status.
No change to pnpm's optional-dependency policy or mandatory native acceleration.

## Runtime / API Contract

`pnpm-lock.yaml` owns installed versions and integrity for Node and Deno CI.
`pnpm install --frozen-lockfile` must fail on manifest/lock drift. Deno executes
the installed `npm:vitest` and package code using manual node_modules mode.
CI, the release runner, the release workflow and operator commands specify that
mode explicitly.
Source and lock changes are reviewed together through normal pull requests.

## Architecture / Anti-SLUDGE Posture

No domain, port or adapter change. Installation and runtime remain explicit
tooling boundaries; no nonzero installer status is converted into success.

## Compatibility / Migration Posture

No public package dependency or storage-format change. Existing Deno test
entrypoints remain available. The development image uses pnpm for installation;
its application execution and type checking continue under Deno.

## Error Contract

Nonzero pnpm installation and runtime exit statuses propagate to Docker/CI.
The frozen install rejects a stale manifest/lock pair. Update the manifest and
lock through an intentional dependency change; never regenerate the graph
silently in CI.

pnpm retains its existing optional-dependency semantics: an optional package can
be absent after a platform skip or a fetch/build failure without failing the
install. In particular, cbor-x's native cbor-extract accelerator is optional;
its JavaScript implementation remains available. A successful install therefore
does not prove that native acceleration loaded. The runtime gates must pass
against the installed graph. This contract does not promote an optional
accelerator into a required dependency.

## Accessibility Posture

Commands, exit status, version output and JSON witness are readable linearly.
No visual-only result or new interaction surface.

## User-Facing Text / Directionality

English operator guidance only; no direction-sensitive layout or localization
process is introduced.

## Agent Inspectability / Explainability Posture

The witness identifies the source revision, package/lock hashes, tool versions,
resolved cbor-extract version, phase exit codes and exact CI commands. Installation
success is distinct from runtime success and from a complete release.

## Linked Invariants

Normal hooks; Docker-only tests; public package compatibility; failed gates
remain failures; one coherent issue/PR.

## Design Alternatives Considered

A second Deno lock adds another graph to maintain. Pinning one broken optional
package only treats today's symptom. Ignoring a nonzero installer exit would
conceal a failed installation. The existing lock already describes a working
graph, including optional packages with their existing fallback semantics.

## Decision

Reuse pnpm's frozen graph with Deno manual mode. This is a
[supported Deno workflow](https://docs.deno.com/runtime/fundamentals/node/#manual-node_modules-creation);
the pinned Deno 2.7.1 executable must also prove it in the guarded worker.

## Proof Surface

Fresh baseline Deno resolution records whether the missing-package condition
still holds and checks the selected extraction version against the frozen graph.
A clean pnpm install must succeed, retain the lock bytes, reject a
changed manifest with that same frozen lock, and reach actual Deno execution.
The full required unit/integration/declaration commands then prove runtime scope.
A Dockerfile string assertion or reused node_modules alone is insufficient.

## Implementation Slices

One independently mergeable repair: install path, invocation mode, evidence and
documentation land together.

## Tests To Write First

Run the original fresh `deno install --allow-scripts` in the existing COPY-only
worker with no preinstalled project dependencies or Deno cache. Preserve its
result separately from the repaired phase; upstream publication can change it.
Require the locked extraction version to expose the original graph drift.
Existing CI commands are the runtime
acceptance tests; no source-text mirror test substitutes for them.

## Acceptance Criteria

- Fresh installation chooses the committed graph without changing lock bytes.
- A stale manifest/lock pair fails before tests.
- Deno unit, integration and both declaration fixtures pass.
- Normal lint, hooks and current-head CI pass.
- Review and exact source/version/witness records are retained.

## Validation Plan

Reuse the bounded `git-cas-tests` worker under its canonical workstation lock.
All fresh-install/cache/store outputs stay inside its 3 GiB runtime filesystem,
with existing time, CPU, memory, log and host/VM free-space guards. Run finite
phases serially. Rehearse install commands in that existing image, then verify
the changed Dockerfile itself in hosted CI. Run lint and Node unit checks too.

## Playback / Witness

The witness will answer: did the original failure occur, which lock selected the
repair graph, can drift be rejected, and which commands actually ran under Deno?
Raw local logs remain separate from a portable committed summary and hashes.

[Executed witness](witness/install.md) and [machine receipt](witness/install.json)
record the successful local rehearsal, the historical install failure and the
separate graph-drift regression. Hosted Dockerfile validation remains a PR gate. The
[release-path follow-up](witness/release-paths.md) records the missing explicit
mode in release commands, its regression assertion and corrected runtime checks.

## Risks

pnpm's layout or lifecycle scripts could expose a Deno compatibility issue;
actual Deno unit/integration/declaration execution is required. Network service
availability is still required on a cold install. A frozen graph does not promise
that upstream tarballs will remain downloadable forever.

## Follow-On Debt

[#161](https://github.com/git-stunts/git-cas/issues/161) tracks the pre-existing
unlocked Bun test-image installation. It is an independent follow-up, not a
prerequisite for this Deno repair. No current Bun runtime failure is claimed.

## Tracker Disposition

Close #159 only after this coherent repair lands with verified checks. Keep #157
open; this repair does not prove reservation correctness or publish a release.

## Done Does Not Mean

No full reproducible-image claim: base image tags and package-manager major
selection are existing separate inputs. This repair freezes the project graph.
No new release, registry consumer result or complete reservation acceptance.

## Retrospective

Write after merge under the METHOD retrospective path; preserve actual failures
and repairs in the witness rather than rewriting them as an all-green run.
