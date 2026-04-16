# 0034-framed-v1-default-encrypted-store

## Title

Make `framed-v1` the default for new encrypted stores

## Why

`framed-v1` is now the honest authenticated streaming encryption mode, but new
encrypted stores still default to `whole-v1` compatibility behavior unless the
caller opts in explicitly.

That leaves the better restore behavior available but not normal.

## Decision

Flip the default-write behavior:

- encrypted store with no explicit `encryption.scheme` now writes `framed-v1`
- `encryption.frameBytes` without a scheme becomes valid and implies the
  default framed mode
- `whole-v1` remains available only through an explicit opt-out
- restore compatibility for existing legacy/`whole-v1` manifests remains
  unchanged

## Scope

This cycle covers:

- store-time encryption default routing
- tests for omitted-scheme and frameBytes-without-scheme behavior
- user-facing docs that explain the new default and the explicit `whole-v1`
  opt-out path

This cycle does not cover:

- changing restore behavior for existing manifests
- removing `whole-v1`
- changing runtime-specific restore constraints

## Playback Questions

1. Do encrypted stores with no explicit scheme now emit `framed-v1` metadata?
2. Does `encryption.frameBytes` work without also spelling out
   `scheme: 'framed-v1'`?
3. Is `whole-v1` still available as an explicit compatibility opt-out?
4. Do the README, API, and walkthrough now describe `framed-v1` as the normal
   encrypted-write path and `whole-v1` as the explicit compatibility mode?

## Red Tests

The executable spec will live in:

- `test/unit/domain/services/CasService.test.js`
- `test/unit/domain/services/CasService.envelope.test.js`

## Green Shape

Make the better encrypted-write mode the boring default and move `whole-v1`
fully into explicit-compatibility territory.
