# Cycle Tests

Cycle-owned playback, regression, and spec tests live here when the cycle
benefits from a dedicated test namespace.

This does not replace the normal unit and integration suite.

Use this directory when a cycle has:

- a clear protocol or playback contract
- a bounded regression surface worth naming directly
- test fixtures or helper structure that belong to the cycle more than to a
  package
