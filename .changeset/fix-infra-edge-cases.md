---
'@novastarter/env': patch
'@novastarter/logger': patch
'@novastarter/emitter': patch
'@novastarter/errors': patch
'@novastarter/pressure': patch
---

The JS config loader refuses a `null` export with its documented error instead of crashing on a `TypeError`, `LogsStream` strips pino's trailing newline and swaps non-JSON lines for a fallback line instead of crashing the process, `createHttpLogger` layers the built `ignore` over a caller's `autoLogging` instead of replacing it, the emitter always reports the real event name even when caller meta carries an `event` key, and the errors package renames its per-module message builders (`hitRateLimitMessage`, `invalidPayloadMessage`).
