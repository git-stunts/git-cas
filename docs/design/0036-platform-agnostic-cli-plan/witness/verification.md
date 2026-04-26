# Witness — 0036 Platform-Agnostic CLI Plan

## Playback

1. Does the repo now state plainly that the current CLI is Node-oriented even
   though the core CAS logic is multi-runtime-tested?
   Yes. The plan explicitly distinguishes the multi-runtime-tested core from
   the still-Node-oriented launcher and subprocess surfaces.

2. Is there a concrete adapter boundary for argv, stdio, prompt, file, exit,
   and Git runner behavior?
   Yes. The plan proposes an explicit runtime adapter and separate Git runner
   boundary instead of scattering runtime checks through command code.

3. Does the plan separate runtime-neutral command logic from platform-specific
   launcher and packaging concerns?
   Yes. It treats launcher packaging as a later concern after the command core
   and runtime adapter seams are clean.

4. Does the plan point follow-on execution toward existing portability and
   decomposition debt instead of inventing a vague new portability track?
   Yes. It points directly at `TR — Platform Dependency Leaks` and
   `TR — CasService Decomposition Plan`.

## RED -> GREEN

- Planning truth spec:
  - `test/unit/docs/planning-surfaces.test.js`
- Green artifacts:
  - `docs/design/0036-platform-agnostic-cli-plan/platform-agnostic-cli-plan.md`
  - planning and truth-surface updates that retire the backlog card

## Validation

- `npm test`
- `npx eslint .`
- `git diff --check`

## Notes

- This cycle is a plan, not a runtime-portability implementation slice.
- The next real implementation work now belongs in `bad-code/`.
