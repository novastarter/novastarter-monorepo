---
'@novastarter/memory': patch
---

Redis memory drivers: the key-value store and the pub/sub bus now read gzip-compressed values regardless of their own compression setting (compression stays decided per value on write), the bus `unsubscribe()` after `close()` returns instead of hanging on a dead connection, and the bus subscriber connection logs its errors through the registered logger instead of emitting an unhandled `error` event.
