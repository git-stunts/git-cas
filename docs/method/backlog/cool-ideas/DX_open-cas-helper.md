# DX: One-step CAS opener

## The Idea

Add a public helper such as:

```js
const cas = await ContentAddressableStore.open({ cwd: '.', codec: 'json' });
```

The helper would create `GitPlumbing.createDefault({ cwd })`, select JSON or
CBOR, and forward advanced options like chunking, concurrency, compression, and
observability.

## Why It's Interesting

- Removes the first-contact need to understand both `@git-stunts/plumbing` and
  `ContentAddressableStore` before storing one file.
- Gives README, GUIDE, examples, and agent-adjacent docs one canonical quick
  setup snippet.
- Reduces the chance of stale plumbing factory snippets.

## Tradeoffs

- Adds another public entry point to support.
- Needs careful naming so advanced users still understand when to use the
  explicit plumbing constructor path.

## Status

- Captured during the 2026-05-04 code quality and documentation audits.
