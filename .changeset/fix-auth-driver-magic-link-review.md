---
'@novastarter/auth-driver-magic-link': minor
---

`begin()` no longer waits for `send`, so the response time no longer reveals which addresses have accounts; a failed
send goes to the new optional `onSendError` option instead of the caller.

An `onSendError` that throws or rejects is dropped instead of becoming an unhandled rejection.
