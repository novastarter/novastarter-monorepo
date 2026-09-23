---
'@novastarter/memory': minor
---

Redis `usingLock` now rethrows the callback's own error when the lock release also fails, Redis `clear()` now throws when Redis refuses an `UNLINK` instead of reporting success, and the multi cache now drops its whole L1 after the bus subscriber reconnects, through the new optional `BusDriver.onReconnect`, which the Redis bus runs only once the resubscribe is active on the server, so invalidations missed during the outage cannot leave stale values in memory.
