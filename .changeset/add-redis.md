---
'@novastarter/redis': minor
'@novastarter/env': minor
---

Add `@novastarter/redis` with `createRedis`, `useRedis` and `redisConfigAvailable`, which build one shared ioredis client per location from the `REDIS_*` environment variables; further servers are listed in `REDIS_LOCATIONS` and configured under `REDIS_<NAME>_*`, which `@novastarter/env` now recognises for `_FILE` secrets and type casting.
