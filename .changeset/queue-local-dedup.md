---
'@novastarter/queue': patch
---

The `local` queue driver now collapses a second enqueue of the same `unique` work or explicit `jobId` while the first job is still queued or running, answering the first job's identity instead of running the handler twice.
