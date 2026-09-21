---
'web': patch
---

`shutdown()` of the `web` app now closes every manager — queue, mail, storage, the four memory ones — before the shared Redis clients, instead of the queue and Redis alone.
