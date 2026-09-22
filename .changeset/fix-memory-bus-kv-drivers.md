---
'@novastarter/memory': patch
---

The Redis bus inbox chain no longer dies on a throwing logger and skips all later messages, and its subscriber maps handle channels named like `Object.prototype` members (`toString`, `constructor`) as channels. The Redis kv `increment` now translates only the exact `INCRBY` reply error (`ERR value is not an integer or out of range`) into the shared error instead of any message containing "not an integer", so unrelated Redis errors pass through unchanged. The local kv store builds its `LRUCache` with typed options instead of a cast, and the multi cache's `clearOthers` declares its return type.
