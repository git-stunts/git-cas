# TR — Web Crypto Streaming Parity

## Why This Exists

Node and Bun now have a real whole-object decryption stream seam for bounded
file restore, but the Web Crypto adapter still buffers internally for
`createDecryptionStream()`.

That means the repo's streaming story is still runtime-dependent in a way that
is easy to miss.

## Target Outcome

Design and land a clear parity story for Web Crypto runtimes that:

- either provides genuinely bounded decryption behavior
- or makes the runtime limitation explicit and impossible to misread
- keeps `framed-v1` and `whole-v1` behavior honest across Node, Bun, and Web
  Crypto environments

## Human Value

Operators should be able to know whether “streaming restore” means the same
thing in Node, Bun, and Deno/browser-class runtimes.

## Agent Value

Agents should be able to choose the right restore mode without assuming Node
semantics apply everywhere.

## Notes

- distinguish API shape from internal buffering
- keep `whole-v1` auth-boundary honesty intact
- coordinate with docs, not just adapter code
