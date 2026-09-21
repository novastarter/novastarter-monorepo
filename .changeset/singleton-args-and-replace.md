---
'@novastarter/utils': minor
'@novastarter/logger': minor
'@novastarter/env': minor
---

`singleton()` hands the arguments of the first call to its builder and gains `replace(instance)`; `useLogger`, `getLogsStream`, `getHttpLogsStream` and `useEnv` are built on it like every other `use*()` of the kit, so their `_cache` objects are gone and tests reset them with `useLogger.reset()` / `useEnv.reset()`.
