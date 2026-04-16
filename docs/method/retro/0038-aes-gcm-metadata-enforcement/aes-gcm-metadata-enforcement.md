# Retro — 0038 AES-GCM Metadata Enforcement

## Drift Check

- The cycle stayed at the crypto adapter boundary.
- It did not reopen manifest schema rules or payload-format work.

## What Shipped

- Added one shared AES-GCM metadata validator/decoder.
- Routed Node, Bun, and Web Crypto decrypt paths through it.
- Added focused RED/GREEN coverage for malformed algorithm, nonce, and tag
  metadata.

## What Did Not

- No manifest schema changes.
- No framed-v1 or whole-v1 format changes.

## Debt

- None added. This card is closed.

## Cool Ideas

- If more cipher suites are added later, this validator pattern can become a
  small family of adapter-boundary metadata validators instead of growing
  ad-hoc checks in each runtime adapter.
