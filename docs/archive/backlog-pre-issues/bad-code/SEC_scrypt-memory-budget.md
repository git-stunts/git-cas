# SEC: scrypt combined memory cost uncapped

- **File**: `src/helpers/kdfPolicy.js:127-147`
- **Severity**: Medium
- **Category**: Computational DoS via crafted manifests

## Description

`assertKdfPolicy()` validated each scrypt parameter independently (N, r, p) but
did not validate their combined memory cost `128 * N * r`. The worst case within
policy bounds was N=1,048,576, r=32, yielding ~4 GiB memory allocation — enough
to OOM a restoring node.

An attacker who can craft a manifest with extreme but policy-valid scrypt params
could trigger this on the victim's machine during restore.

## Fix

Added a combined memory budget check: `128 * cost * blockSize` must not exceed
1 GiB. This still allows max N (1,048,576) with default r (8) but blocks the
extreme combinations.

## Status

- [x] Resolved — `security/audit-fixes` branch
