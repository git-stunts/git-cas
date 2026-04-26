# 0037-scrypt-maxmem-budget-dedup

## Title

Deduplicate scrypt `maxmem` budgeting across crypto adapters

## Why

The KDF policy hardening work had to add explicit scrypt `maxmem` budgeting in
the Node, Bun, and Web Crypto adapter paths so the stronger default cost works
in practice.

That formula now exists in three places.

## Decision

Move the scrypt `maxmem` calculation into one shared helper and make every
runtime adapter call through it.

## Scope

This cycle covers:

- one shared `scryptMaxmem` helper
- Node, Bun, and Web Crypto adapter use of that helper
- a focused unit test for the helper contract

This cycle does not cover:

- changing KDF policy values
- changing adapter-specific derive behavior beyond the duplicated budget math

## Playback Questions

1. Do Node, Bun, and Web Crypto fallback all derive scrypt `maxmem` from one
   shared helper now?
2. Is the helper test explicit about the budgeting formula instead of leaving
   it implicit in adapter implementations?
3. Did the cycle stay scoped to deduplicating the shared budget math?

## Red Tests

The executable spec will live in:

- `test/unit/domain/helpers/scryptMaxmem.test.js`

## Green Shape

One small helper, three adapters cleaned up, zero runtime-specific drift in the
scrypt memory budget formula.
