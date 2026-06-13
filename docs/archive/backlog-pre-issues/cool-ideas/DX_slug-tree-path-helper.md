# DX: Slug Tree-Path Helper

## The Idea

Once slug validation became a domain value object, expose a small method for the
Git tree-entry representation:

```js
const treePath = Slug.from('docs/readme').toTreePath();
```

## Why It's Interesting

- Keeps slash and percent encoding attached to the validated slug concept
  instead of scattered beside vault tree-building code.
- Gives `VaultService` one readable call site for plain vault tree entry names.
- Makes future tree-path rules easier to test without reaching into vault
  mutation internals.

## Tradeoffs

- The helper intentionally remains an internal domain value-object API, not a
  public package export.
- Decoding still requires a validation step when reading repository-controlled
  tree entries.

## Status

- [x] Adopted — v6.0.0 final polishing
