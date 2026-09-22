---
'@novastarter/queue': minor
---

`unique` jobs and explicit `jobId`s run again after a failed or kept record on BullMQ (a `unique` id is now the deduplication key and `enqueue()` answers BullMQ's record id), the driver receives the payload as passed so schema transforms apply once, `stats().counts.waiting` includes prioritised jobs, the local driver honours delays beyond 24.8 days and refuses a negative one, both drivers refuse work after `close()`, the `bullmq` driver refuses a missing `connection`, `defineJob()`/`createWorker()` throw a `RangeError` for a `timeout` outside 0..MAX_TIMER_DELAY (`timeout: 0` is now a 0 ms limit, not 'none'), `startSchedules()` accepts the package's own `enqueue` and skips a second schedule resolving to a rule already taken.
