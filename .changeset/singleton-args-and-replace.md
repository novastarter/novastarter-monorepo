---
'@novastarter/utils': minor
'@novastarter/logger': minor
'@novastarter/env': minor
---

`singleton()` hands the arguments of the first call to its builder — and throws on a later call that passes arguments, since they would be silently ignored — gains `replace(instance)` and keeps an `undefined` answer of the builder like any other instead of rebuilding; `useLogger`, `getLogsStream`, `getHttpLogsStream` and `useEnv` are built on it like every other `use*()` of the kit, so their `_cache` objects are gone and tests reset them with `useLogger.reset()` / `useEnv.reset()`. `useEnv(options)` is therefore the call of the application's boot; every other caller uses `useEnv()`. `getLogsStream()` and `getHttpLogsStream()` refuse a first call without `(pretty, messenger)` instead of building a stream that fails on its first line, and `LogsStream` drops a line the bus refuses instead of leaving an unhandled rejection.
