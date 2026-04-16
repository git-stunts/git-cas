# TR — Framed V1 Authenticated Encryption

## Why This Exists

`git-cas` now has an explicit encryption-mode foundation with `whole-v1`
serialized in manifests and routed explicitly during store, restore, and verify
paths.

That unlocks the next real step: implement a framed authenticated mode instead
of treating “streaming encrypted restore” as a vague aspiration.

## Target Outcome

Design and land a `framed-v1` mode that:

- authenticates and restores content frame-by-frame
- uses explicit manifest metadata that distinguishes it from `whole-v1`
- preserves fail-closed restore and verify behavior
- defines runtime expectations for Node, Bun, and Web Crypto

## Human Value

Operators should be able to opt into a real authenticated streaming-friendly
mode instead of inferring behavior from buffering limits.

## Agent Value

Agents should be able to implement and reason about framed encryption as a
named format with explicit guarantees rather than as ad hoc decryption tweaks.

## Notes

- build on the `whole-v1` foundation already landed
- keep integrity semantics explicit before optimizing throughput
- coordinate with the existing streaming-encrypted-restore work so the format
  and restore path are designed together
