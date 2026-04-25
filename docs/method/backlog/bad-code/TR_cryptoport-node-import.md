# TR: CryptoPort imports node:crypto directly

- **File**: `src/ports/CryptoPort.js:1`
- **Severity**: Medium
- **Category**: Architecture drift / platform coupling in port layer

## Description

`CryptoPort.hmacSha256()` is a concrete method that imports `createHmac` from
`node:crypto`. The port layer is supposed to be abstract — platform-specific
implementations belong in adapters.

This was introduced during the vault privacy mode implementation as a quick path.
It works across Node/Bun/Deno (all support `node:crypto`), but it violates the
architectural contract and would break in a browser environment.

## Fix

1. Make `hmacSha256(key, data)` abstract (throw "Not implemented")
2. Implement in `NodeCryptoAdapter`, `BunCryptoAdapter`, and `WebCryptoAdapter`
3. WebCrypto adapter uses `crypto.subtle.sign('HMAC', ...)` with imported key
4. Remove `node:crypto` import from CryptoPort
