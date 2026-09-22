---
'@novastarter/logger': minor
---

createLogger keeps REDACTED_PATHS when the app passes its own `pino.redact` (new `buildRedactOptions` export), createHttpLogger merges the app's `http.serializers` instead of dropping them, no longer crashes the server on a request target like `//` when `ignorePaths` is set, and LogsStream folds sub-millisecond requests (`responseTime: 0`) into the one-line HTTP message.
