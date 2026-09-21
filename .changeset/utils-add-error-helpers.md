---
'@novastarter/utils': minor
---

Add `toErrorMessage` and `toError` to the shared entry point: the two helpers that turn a `catch (error: unknown)` into a one-line message or an `Error` with the original as `cause`, never throwing themselves.
