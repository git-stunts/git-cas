# TR — Agent CLI OS-Keychain Passphrase

## Why

The human CLI can resolve vault passphrases from the OS keychain via
`@git-stunts/vault`, but the agent CLI still only accepts inline, file, and
request-body passphrase sources.

## Tension

The split is deliberate for this slice, but it leaves the machine-facing CLI
behind the human-facing one for secret ergonomics.

## Next Move

Add a structured OS-keychain passphrase source to the agent CLI without making
the protocol ambiguous or implicitly interactive.
