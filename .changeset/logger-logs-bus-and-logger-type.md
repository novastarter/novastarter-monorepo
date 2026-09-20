---
'@novastarter/logger': minor
---

`LogsStream`, `getLogsStream` and `getHttpLogsStream` accept any object with a `publish(channel, payload)` method (the new `LogsBus` type) so `@novastarter/logger` no longer depends on `@novastarter/memory` — a `Bus` still works unchanged — and pino's `Logger` type is re-exported, so a package typing a logger option imports it from `@novastarter/logger` instead of depending on `pino`.
