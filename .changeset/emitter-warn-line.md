---
'@novastarter/emitter': patch
---

The `Emitter` logs a failing hook as one `warn(error, message)` line, wrapping a non-`Error` thrown value through `toError` so its text is not lost; an action handler that throws synchronously is logged the same way instead of throwing out of `emitAction()` into the caller that emitted the event.
