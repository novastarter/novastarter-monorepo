---
'@novastarter/redis': patch
---

`createRedis` — and so every client a `RedisManager` location opens — now listens for ioredis `error` events and reports them through the given or process logger, so a Redis server that is unreachable at boot or flaps mid-run no longer reaches the host process as an unhandled error event (which crashes it on several paths) or as an uncontrolled stderr print.
