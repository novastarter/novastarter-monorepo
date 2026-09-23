---
'@novastarter/logger': patch
---

`createLogger` now honours levels declared in `pino.customLevels` for `level` and `logsStream.level`, instead of silently writing nothing or throwing `unknown level`.
