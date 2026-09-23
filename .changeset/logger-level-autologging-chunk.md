---
'@novastarter/logger': patch
---

`createLogger` now throws `unknown level <name>` for an invalid `logsStream.level` instead of building a logger whose multistream writes nothing anywhere, `createHttpLogger` no longer re-enables completion logging when `http.autoLogging: false` is combined with `ignorePaths`, and `LogsStream` publishes its fallback line for a non-string chunk instead of crashing on it.
