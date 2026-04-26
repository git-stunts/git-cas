# 0031-empty-state-phrasing-consistency

## Title

Codify one empty-state phrase and sync the planning indexes to repo truth

## Why

The empty-state phrasing card looked small, but the real issue next to it was
planning-surface drift.

The repo already leaned toward one empty-state phrase, but the house style was
not documented clearly enough and some index or legend summaries had drifted
away from the current backlog files.

That creates unnecessary review noise and weakens trust in the planning
surfaces.

## Decision

Treat this as a small docs-truth cycle:

- codify one empty-state bullet style for planning surfaces
- keep the mechanical phrase explicit: `- none currently`
- sync the main design, backlog, and legend indexes to the files they describe

## Scope

This cycle covers:

- empty-state wording in planning/index/legend docs
- design index sync
- backlog index sync
- current legend backlog link sync

This cycle does not cover:

- general copy editing outside planning surfaces
- backlog reprioritization
- larger legend redesign

## Playback Questions

1. Do planning surfaces use one explicit empty-state bullet style instead of
   mixed wording?
2. Does the main backlog index match the lane files on disk?
3. Does the active design index match the numbered cycle directories on disk?
4. Do the current legend backlog links point to real files instead of stale
   paths?

## Red Tests

The executable spec will live in:

- `test/unit/docs/planning-surfaces.test.js`

## Green Shape

Keep the pass mechanical and boring. This is not a rewriting cycle; it is a
trust-and-consistency cycle.
