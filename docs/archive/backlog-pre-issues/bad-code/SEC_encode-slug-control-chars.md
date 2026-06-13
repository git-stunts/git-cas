# SEC: encodeSlug doesn't handle control characters

- **File**: `src/domain/services/VaultService.js:40-41`
- **Severity**: Low
- **Category**: mktree format injection

## Description

`encodeSlug()` only percent-encoded `/` and `%` but passed NUL bytes, newlines,
and tabs through unmodified. While `validateSlug()` rejects these on the store
path, the vault tree rebuild path (`writeCommit`) reads existing entry names from
git, decodes them with `decodeSlug`, and re-encodes with `encodeSlug` — bypassing
`validateSlug`. A tampered vault tree with control chars in entry names would
corrupt `mktree` input during any subsequent vault mutation.

## Fix

Added a `hasControlChars()` guard at the top of `encodeSlug()` that throws
`INVALID_SLUG` if the input contains any ASCII control characters (0x00–0x1f, 0x7f).

## Status

- [x] Resolved — `security/audit-fixes` branch
