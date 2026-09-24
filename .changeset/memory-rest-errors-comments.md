---
'@novastarter/memory': minor
---

`LimiterDriverLocal`, `LimiterDriverRedis` and `CacheDriverMulti` now throw `InvalidConfigError` (`INVALID_CONFIG`) instead of `RangeError` for a bad `duration`, `points` or a `local.ttl` longer than `redis.ttl`.
