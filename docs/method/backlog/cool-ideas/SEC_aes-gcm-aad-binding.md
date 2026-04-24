# SEC — AES-GCM Associated Data Binding

## The Idea

None of the crypto adapters pass AAD (Additional Authenticated Data) to AES-GCM.
This means manifest metadata (slug, filename, chunk index) is not cryptographically
bound to the ciphertext. An attacker with repo write access could swap encrypted
blobs between two manifests using the same key and decryption would succeed silently.

Binding the slug + chunk index as AAD would make each encrypted blob
non-transferable — decryption would fail if the blob was moved to a different
manifest or chunk position.

## Why It's Interesting

- Zero performance cost (AAD is just hashed, not encrypted)
- Prevents a real attack vector documented in the threat model
- Could be opt-in via a new encryption scheme (`whole-v2`? `framed-v2`?) to
  avoid breaking backward compatibility
- The crypto port already has the plumbing — just needs the AAD parameter wired
  through from CasService
