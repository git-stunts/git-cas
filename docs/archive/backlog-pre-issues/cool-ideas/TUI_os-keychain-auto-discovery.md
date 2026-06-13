# Cool Idea: OS keychain auto-discovery for vault passphrase

## What
The title screen password flow could check `@git-stunts/vault` for a stored passphrase target before showing the manual prompt. If the OS keychain has a matching entry, unlock automatically and skip the password screen entirely.

## Why
Operators who use `--os-keychain-target` on the CLI shouldn't have to re-enter their passphrase every time they open the dashboard. The keychain is the secure storage — let it work.

## Sketch
1. Title screen fires `checkVaultAuthCmd`
2. If encrypted, try `vault.get(keychainTarget)` first
3. If keychain returns a passphrase, verify it silently
4. If verification passes → skip password screen, go to dashboard
5. If no keychain entry or verification fails → show password prompt as today
