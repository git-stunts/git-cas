# Retro — 0033 Web Crypto Streaming Parity

## Drift Check

- The cycle stayed on Web Crypto whole-object buffering and runtime-truth docs.
- It did not alter `whole-v1` authenticity semantics or make false claims about
  one-shot AES-GCM somehow becoming true streaming.
- It did not change the encrypted write default.

## What Shipped

- `WebCryptoAdapter.createDecryptionStream()` now has a decryption-side buffer
  guard instead of collecting ciphertext without a bound.
- `WebCryptoAdapter` now accepts separate encryption and decryption buffer
  limits.
- The adapter tests now pin both the bounded failure and the within-limit
  round-trip behavior.
- Public docs now describe the runtime difference explicitly: Node/Bun have the
  stronger low-memory `whole-v1` file path, while Web Crypto stays
  bounded-buffer for whole-object decrypt.

## What Did Not

- `whole-v1` is still not true authenticated streaming on Web Crypto.
- This cycle did not change `restoreStream()` semantics.
- `framed-v1` is still opt-in for new encrypted stores.

## Debt

- None added. The remaining strategic follow-on is already queued as
  `TR_framed-v1-default-encrypted-store.md`.

## Cool Ideas

- If the repo eventually exposes adapter configuration more directly at the
  facade layer, the Web Crypto buffer limits could become first-class operator
  knobs instead of adapter-constructor details.
