---
'@novastarter/memory': minor
---

The driver classes of `@novastarter/memory` are now `KvDriverLocal`, `KvDriverRedis`, `CacheDriverLocal`, `CacheDriverRedis`, `CacheDriverMulti`, `BusDriverLocal`, `BusDriverRedis`, `LimiterDriverLocal` and `LimiterDriverRedis`, with `…Config` option types in place of `…Options` (`KvLocalOptions` → `KvDriverLocalConfig`, `LimiterOptionsBase` → `LimiterDriverConfigBase`); `Kv`, `Cache`, `Bus`, `Limiter`, the managers and the location keys are unchanged.
