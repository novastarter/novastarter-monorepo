---
'@novastarter/memory': patch
---

The Redis key-value driver now stores a `setMax` value exactly like `set` does: the value reaches the Lua script as text and is stored verbatim, so reading a float back returns the same number `set` stores instead of a 17-digit expansion such as `0.10000000000000001` for `0.1`.
