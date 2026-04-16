# TR — Buffered Restore ReadBlob Fallback

## Why This Exists

Buffered restore hard limits are now real on stream-native persistence
adapters, but the compatibility fallback to `readBlob()` still materializes the
entire blob before the size check runs.

That means custom or older adapters without `readBlobStream()` do not get the
same hard blob-read boundary.

## Target Outcome

Design and land a cleaner fallback story that:

- either requires `readBlobStream()` for hard-limited buffered restore modes
- or exposes an explicit adapter capability contract instead of silently
  degrading to best-effort behavior
- keeps mocks and tests easy to write without pretending the fallback is just
  as safe

## Human Value

Maintainers should be able to tell when buffered restore guarantees depend on
adapter capabilities instead of assuming every adapter is equally safe.

## Agent Value

Agents should be able to reason about buffered restore safety from explicit
adapter contracts rather than hidden fallback behavior.

## Notes

- keep this scoped to buffered restore safety
- coordinate with the existing `readBlobStream()` persistence seam instead of
  inventing another blob API
