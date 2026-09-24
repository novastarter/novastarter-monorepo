---
'@novastarter/memory': minor
---

The local and Redis kv drivers now throw `InvalidConfigError` instead of `RangeError` for a bad `lockTimeout` or a Redis client on a database above 15.
