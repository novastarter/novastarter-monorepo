---
'@novastarter/emitter': patch
---

The `Emitter` logs a failing hook as one `warn(error, message)` line, wrapping a non-`Error` thrown value through `toError` so its text is not lost; an action handler that throws synchronously is logged the same way instead of throwing out of `emitAction()` into the caller that emitted the event, and the handlers registered after it still run; every action and init handler is wrapped on registration and logs its own failure, so two failing handlers make two log lines where `emitAsync` used to surface only the first, and `offAction` / `offInit` still remove by the handler you registered.
