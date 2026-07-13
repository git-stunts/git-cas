# I-002 - Application Storage Ownership

## Statement

`git-cas` owns physical content-addressed storage and reusable cache lifecycle.
Application packages own domain meaning and retention intent; they must not
need to implement Git object graphs, cache-index refs, expiry, eviction,
reachability repair, or storage accounting.

## Non-Negotiable Truths

- A payload handle identifies content. It does not, by itself, claim durability.
- Git reachability and application retention policy are separate axes.
- OID text inside metadata is not a reachability edge.
- Retained data has an actual Git edge and inspectable generation evidence.
- Mutable cache generations do not preserve released history by default.
- Unexpired security markers cannot be removed by ordinary capacity policy.
- Large structured state can be addressed and read by member or page.
- Streaming claims begin at the storage boundary and include residency proof.
- Repair never fabricates missing bytes or silently broadens retention.

## Application Boundary

Applications may define:

- keys, namespaces, payload schemas, and codecs
- causal commit messages, parent order, and ref-transition rules
- whether data should be pinned, evictable, expiring, or vault-kept
- what a receipt says about domain behavior

Applications must delegate:

- asset, manifest, tree, bundle, and page creation
- handle validation and storage-format inspection
- RootSet/cache ref coordination
- TTL, recency, capacity, sweep, doctor, and repair mechanics
- physical object and reachability evidence

## Why This Matters

Duplicated CAS and cache implementations fail at lifecycle edges: live data can
be pruned, removed values can remain reachable forever, read hits can create
write amplification, and ordinary LRU eviction can weaken security. One storage
owner makes those transitions testable once and keeps applications focused on
their causal and domain contracts.
