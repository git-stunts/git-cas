# 0035-agent-cli-os-keychain-passphrase

## Title

Add OS-keychain vault passphrase sources to the agent CLI

## Why

The human CLI can resolve vault passphrases from the OS keychain through
`@git-stunts/vault`, but the machine-facing `git cas agent` surface still only
supports inline passphrases and passphrase files.

That leaves the agent protocol behind the human CLI on secret ergonomics.

## Decision

Add explicit OS-keychain passphrase sources to the agent CLI without making the
protocol interactive or ambiguous.

This cycle will:

- add `osKeychainTarget` / `osKeychainAccount` support to agent store,
  restore, and vault init
- add `oldOsKeychainTarget` / `oldOsKeychainAccount` and
  `newOsKeychainTarget` / `newOsKeychainAccount` support to agent vault rotate
- keep passphrase-source validation explicit and mutually exclusive
- keep keychain lookup opt-in and non-interactive

## Scope

This cycle covers:

- agent CLI passphrase source parsing
- agent CLI passphrase source validation
- OS-keychain-backed passphrase resolution through `@git-stunts/vault`
- unit tests for the new agent passphrase source module

This cycle does not cover:

- changing the core library API
- hidden OS-keychain lookup
- broader agent CLI restructuring

## Playback Questions

1. Can agent store, restore, and vault init accept explicit OS-keychain
   passphrase sources?
2. Can agent vault rotate source old and new passphrases independently from the
   OS keychain?
3. Do mutual-exclusion and stdin-conflict checks stay explicit instead of
   making the protocol ambiguous?
4. Does the agent CLI start payload redact the new keychain source fields
   instead of echoing them back?

## Red Tests

The executable spec will live in:

- `test/unit/cli/agent-passphrase-source.test.js`

## Green Shape

Extract agent passphrase-source logic into a small testable module, reuse the
human CLI keychain resolver, and wire the new source fields into the existing
agent commands without making the JSONL contract interactive.
