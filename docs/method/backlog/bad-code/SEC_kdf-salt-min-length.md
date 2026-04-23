# SEC: No minimum salt byte-length validation

- **File**: `src/helpers/kdfPolicy.js:168-169`
- **Severity**: Low
- **Category**: KDF weakness via crafted manifests

## Description

`prepareStoredKdfOptions()` validated the salt as canonical base64 but did not
enforce a minimum decoded byte length. A crafted manifest with a 1-byte salt
would pass validation. NIST SP 800-132 recommends at least 128 bits (16 bytes).

New writes always use `this.randomBytes(32)` (32 bytes) so only a crafted
manifest from an attacker or bug would have a short salt.

## Fix

Added a minimum salt length check of 16 bytes (128 bits) in
`prepareStoredKdfOptions()`.

## Status

- [x] Resolved — `security/audit-fixes` branch
