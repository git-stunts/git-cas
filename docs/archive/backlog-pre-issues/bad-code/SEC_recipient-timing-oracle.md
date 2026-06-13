# SEC: Trial decryption timing oracle

- **File**: `src/domain/services/KeyResolver.js:165-184`
- **Severity**: Low-Medium
- **Category**: Side-channel / timing oracle

## Description

`resolveKeyForRecipients()` short-circuited on the first successful unwrap via
`return await this.unwrapDek(entry, key)`. The response time was proportional to
the index of the matching recipient, leaking which recipient position matched.

While the attacker would need a valid KEK to trigger a match (limiting practical
exploitability), this is a defense-in-depth concern.

## Fix

Changed to iterate all recipients unconditionally, accumulating the first success
without short-circuiting. The result is returned only after all recipients have
been tried, making timing constant regardless of match position.

## Status

- [x] Resolved — `security/audit-fixes` branch
