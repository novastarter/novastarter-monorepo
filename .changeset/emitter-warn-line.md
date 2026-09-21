---
'@novastarter/emitter': patch
---

The `Emitter` logs a failing hook as one `warn(error, message)` line, wrapping a non-`Error` thrown value through `toError` so its text is not lost.
