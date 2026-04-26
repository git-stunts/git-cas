# Witness — 0031 Empty-State Phrasing Consistency

## Playback

1. Do planning surfaces use one explicit empty-state bullet style instead of
   mixed wording?
   Yes. The docs-checklist and METHOD process now codify `- none currently` as
   the house style, and the planning surfaces covered by the RED spec use that
   exact phrase.

2. Does the main backlog index match the lane files on disk?
   Yes. `docs/method/backlog/README.md` now matches the live `asap/`,
   `up-next/`, `cool-ideas/`, and `bad-code/` lane files.

3. Does the active design index match the numbered cycle directories on disk?
   Yes. `docs/design/README.md` now includes the active 0031 cycle and matches
   the numbered cycle directories.

4. Do the current legend backlog links point to real files instead of stale
   paths?
   Yes. Both legend truth surfaces now point at live backlog notes instead of
   stale references.

## RED -> GREEN

- RED spec:
  - `test/unit/docs/planning-surfaces.test.js`
- Green wiring:
  - `docs/DOCS_CHECKLIST.md`
  - `docs/design/README.md`
  - `docs/method/backlog/README.md`
  - `docs/method/process.md`
  - `docs/method/legends/TR_truth.md`
  - `docs/legends/TR-truth.md`
  - removed promoted backlog note

## Validation

- `npx vitest run test/unit/docs/planning-surfaces.test.js`

## Notes

- This cycle intentionally stayed mechanical. It tightened trust in the
  planning surfaces without reprioritizing backlog work or broad copy editing.
