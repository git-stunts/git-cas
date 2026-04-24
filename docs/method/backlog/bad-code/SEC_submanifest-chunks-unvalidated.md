# SEC: Sub-manifest chunks not individually schema-validated

- **File**: `src/domain/services/CasService.js:1668-1669`
- **Severity**: Low
- **Category**: Trust boundary

## Description

`_resolveSubManifests()` decodes sub-manifest blobs via `this.codec.decode(subBlob)`
and pushes `.chunks` directly into the array. These individual chunk entries are
only validated later when the full decoded object is passed to `new Manifest()`.

If a malicious sub-manifest blob contains chunk entries with extra properties or
malformed fields, they survive into the Manifest's Chunk objects. The Chunk
constructor fix (using `ChunkSchema.parse()` output) mitigates extra properties,
but the chunks are still trusted at decode time without schema validation.

Consider running each sub-manifest chunk through `ChunkSchema.parse()` immediately
after decoding, before pushing into the aggregate array.
