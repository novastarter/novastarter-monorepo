---
'@novastarter/redis': minor
---

`RedisManager` now extends `LocationManager` of `@novastarter/utils` instead of keeping a registry of its own, so `registerLocation`, `location`, `hasLocation`, `locationNames`, `instantiated` and `close` behave like every other manager of the kit; `_cache` is gone, tests reset the manager with `useRedis.reset()`.
