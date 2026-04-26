# Retro — 0039 Buffered Restore ReadBlob Fallback

## Drift Check

- The cycle stayed on buffered restore safety.
- It did not broaden into a persistence-port redesign.

## What Shipped

- Buffered restore now requires `readBlobStream()` instead of pretending the
  `readBlob()` fallback is equally hard-limited.
- Plaintext restore kept the compatibility fallback.
- Adapter-facing docs now say the contract plainly.

## What Did Not

- No plaintext restore behavior changed beyond keeping its existing fallback.
- No file-restore coupling work was attempted here.

## Debt

- None added. This card is closed.

## Cool Ideas

- If persistence capabilities ever become explicit metadata instead of inferred
  method presence, buffered restore can switch from one-off checks to a formal
  capability declaration.
