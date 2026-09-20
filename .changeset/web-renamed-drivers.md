---
'web': patch
---

The `web` app registers `StorageDriverLocal` in its bootstrap and its tests use the renamed `QueueDriverLocal`, `CacheDriverLocal` and `BusDriverLocal` of the kit; nothing changes in how it runs.
