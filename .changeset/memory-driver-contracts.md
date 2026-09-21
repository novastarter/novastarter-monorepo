---
'@novastarter/memory': minor
'@novastarter/mail': patch
'@novastarter/queue': patch
---

The driver contracts of `@novastarter/memory` are now `KvDriver`, `CacheDriver`, `BusDriver` and `LimiterDriver` — the `Driver` suffix every other subsystem uses — so rename the `Kv`, `Cache`, `Bus` and `Limiter` types in calling code; `KvDriverLocal` and `CacheDriverLocal` can now be constructed without a config object.
