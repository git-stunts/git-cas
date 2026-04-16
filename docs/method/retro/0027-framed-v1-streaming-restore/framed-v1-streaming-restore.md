# Retro — 0027 Framed-v1 Streaming Restore

## Drift Check

- The cycle stayed bounded to `framed-v1` store/restore/verify semantics.
- The low-level crypto adapters did not grow a new multi-mode API.
- The CLI surface did not add new encryption flags; existing `encryption`
  options simply started working for `framed-v1`.

## What Shipped

- `store()` and `storeFile()` now accept `encryption: { scheme: 'framed-v1', frameBytes }`.
- Framed stores serialize independently authenticated AES-256-GCM records and
  persist explicit manifest metadata with `scheme` and `frameBytes`.
- `restoreStream()` and `restoreFile()` now stream authenticated plaintext for
  `framed-v1`.
- `framed-v1` plus gzip now restores through streaming gunzip instead of the
  buffered whole-object path.
- `verifyIntegrity()` now parses and authenticates every framed record.
- Public docs now distinguish `whole-v1` compatibility behavior from
  `framed-v1` streaming behavior.

## What Did Not

- `whole-v1` restore behavior did not change; it is still the buffered
  compatibility mode.
- `encrypt()` / `decrypt()` did not become format-routing public APIs.
- No new CLI UX was added beyond forwarding the already-defined `encryption`
  options.

## Debt

- Logged explicit AES-GCM auth-tag-length enforcement as follow-on bad-code in
  `docs/method/backlog/bad-code/TR_explicit-aes-gcm-auth-tag-length.md`.
- The broader `TR_streaming-encrypted-restore.md` investigation still matters
  for `whole-v1` temp-file or bounded-restore policy.

## Cool Ideas

- Benchmark `frameBytes` across Node, Bun, and Web Crypto so the default is
  driven by throughput and memory evidence rather than guesswork.
