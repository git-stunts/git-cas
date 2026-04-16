# Witness — 0034 Framed-v1 Default Encrypted Store

## Playback

1. Do encrypted stores with no explicit scheme now emit `framed-v1` metadata?
   Yes. New encrypted stores now write `scheme: 'framed-v1'` plus the default
   frame size when no explicit scheme is provided.

2. Does `encryption.frameBytes` work without also spelling out
   `scheme: 'framed-v1'`?
   Yes. Providing `frameBytes` without a scheme now implies the framed default
   instead of failing option validation.

3. Is `whole-v1` still available as an explicit compatibility opt-out?
   Yes. Callers can still request `encryption: { scheme: 'whole-v1' }` and get
   the compatibility whole-object format.

4. Do the README, API, and walkthrough now describe `framed-v1` as the normal
   encrypted-write path and `whole-v1` as the explicit compatibility mode?
   Yes. The public docs now describe `framed-v1` as the default encrypted write
   behavior and reserve `whole-v1` for explicit compatibility use.

## RED -> GREEN

- RED spec:
  - `test/unit/domain/services/CasService.test.js`
  - `test/unit/domain/services/CasService.envelope.test.js`
  - `test/unit/domain/services/CasService.empty-file.test.js`
- Green wiring:
  - `src/domain/services/CasService.js`
  - truth surfaces in `README.md`, `docs/API.md`, `docs/WALKTHROUGH.md`,
    `STATUS.md`, `BEARING.md`, and `CHANGELOG.md`

## Validation

- `npx vitest run test/unit/domain/services/CasService.test.js test/unit/domain/services/CasService.envelope.test.js test/unit/domain/services/CasService.empty-file.test.js`
- `npm test`
- `npx eslint .`
- `git diff --check`

## Notes

- Restore compatibility for existing `whole-v1` manifests is unchanged.
- `whole-v1` remains the explicit opt-out path for callers who need it.
