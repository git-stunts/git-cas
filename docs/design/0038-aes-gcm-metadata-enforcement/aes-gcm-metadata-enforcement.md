# 0038-aes-gcm-metadata-enforcement

## Title

Enforce AES-GCM metadata at the crypto adapter boundary

## Why

Encrypted-manifest schema hardening already rejects malformed AES-GCM metadata
when manifests are parsed, but the adapter boundary still trusts the metadata
more than it should.

That leaves two smells:

- decrypt adapters can still accept malformed metadata too far down the stack
- adapter correctness still depends partly on higher-level schema and service
  checks instead of the crypto boundary enforcing its own contract

## Decision

Add one shared AES-GCM metadata validator/decoder and make the Node, Bun, and
Web Crypto adapters all call through it before any decrypt operation starts.

## Scope

This cycle covers:

- one shared AES-GCM metadata validator/decoder
- Node, Bun, and Web Crypto adapter use of that validator
- conformance tests proving malformed metadata is rejected at the adapter
  boundary

This cycle does not cover:

- new manifest schema rules
- framed-v1 format changes
- broader crypto-port redesign

## Playback Questions

1. Do all decrypt adapters now reject malformed AES-GCM metadata before
   runtime-specific decrypt calls?
2. Is the declared AES-GCM algorithm enforced at the adapter boundary instead
   of being trusted implicitly?
3. Did the cycle stay scoped to adapter/runtime enforcement instead of
   reopening schema or format work?

## Red Tests

The executable spec will live in:

- `test/unit/infrastructure/adapters/CryptoAdapter.conformance.test.js`
- `test/unit/helpers/aesGcmMeta.test.js`

## Green Shape

One shared validator, three adapters using it, and no adapter-side path that
accepts short tags, malformed base64, or the wrong algorithm just because a
higher layer forgot to stop it first.
