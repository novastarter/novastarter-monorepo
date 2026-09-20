---
'@novastarter/queue': minor
'@novastarter/errors': minor
'@novastarter/utils': minor
'@novastarter/env': minor
---

Add `@novastarter/queue` with `defineJob` / `registerJob` contracts, `enqueue`, the `QueueManager` of `useQueue()` mapping each queue to a `local` or `bullmq` location the application registers at start-up, `createWorker`, `runJob` and cron `registerSchedule` / `startSchedules`; alongside it `@novastarter/errors` gains `InvalidPayloadError`, `@novastarter/utils` gains `getSimpleHash`, and `@novastarter/env` exports the `Env` type and recognises the `QUEUE_<NAME>_*` variables.
