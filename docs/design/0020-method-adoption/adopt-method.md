# Adopt METHOD

- Cycle: `0020-method-adoption`
- Type: `Design`
- Sponsor human: James
- Sponsor agent: Codex

## Hill

`git-cas` adopts one active development method with explicit backlog lanes,
cycle directories, witness paths, and retros, while keeping older planning
artifacts readable as legacy history instead of competing truth.

## Playback Questions

### Human

- Can a maintainer find the active backlog, release process, and current cycle
  directory without reading the legacy backlog or legend docs first?
- Can a maintainer tell which planning surfaces are current and which are only
  compatibility or history?

### Agent

- Can an agent inspect the filesystem and identify the active METHOD backlog,
  legend, cycle, witness, and retro locations without relying on repo lore?
- Can an agent tell where new work should be filed and where old work is kept
  for history?

## Accessibility And Assistive Reading Posture

This is a docs-only cycle. The required linear reading model is explicit:
`WORKFLOW.md` and `docs/RELEASE.md` act as short signposts, while the full
process and release rules live in `docs/method/`. No meaning should depend on a
diagram, styling, or shared author memory.

## Localization And Directionality Posture

This cycle does not add end-user UI, but it should still prefer directional
language like "current", "legacy", "under", and "next" over hardcoded left or
right metaphors.

## Agent Inspectability And Explainability Posture

The active planning model must be obvious from filenames and directories alone.
Legacy compatibility surfaces must say they are legacy, point at the active
METHOD surface, and stop pretending to be current truth.

## Non-Goals

- rewriting all historical cycle docs into the new format
- deleting legacy planning history
- building the METHOD CLI described in the generic system doc
- changing the product architecture or runtime support as part of this cycle

## Implementation Outline

1. Create the canonical METHOD structure under `docs/method/`.
2. Move the live backlog cards into METHOD lanes and drop numeric IDs from the
   active backlog filenames.
3. Create METHOD legend docs for active named domains.
4. Convert root or one-level planning docs into signposts that point at the
   METHOD surfaces.
5. Mark legacy planning directories as compatibility surfaces instead of active
   truth.
6. Record the transition in the changelog and the markdown-surface audit.
7. Produce witness material that answers the playback questions with concrete
   filesystem paths and verification commands.

## RED

This is a design cycle. The failing condition is documentary drift:

- two different active backlog models
- two different active legend models
- no single canonical place to learn the loop

The witness for this cycle must show that those failures are gone.
