---
'@novastarter/queue': patch
---

Refuse an explicit `jobId` that is an integer string such as `"123"` or `"0"` on every driver, since BullMQ rejects integer custom ids and such an id used to pass the `local` driver in tests and fail only in production.
