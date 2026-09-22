---
'@novastarter/logger': patch
---

The process id attached to published log lines is now resolved when a `LogsStream` is built rather than at import time, matching the package's `sideEffects: false` declaration; the published lines are unchanged.
