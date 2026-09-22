---
'@novastarter/queue': patch
---

`ioredis` is a regular dependency instead of an optional peer, since `@novastarter/redis` already requires it and the `bullmq` driver's types import it; nothing to install. The `bullmq` driver opens a queue once per name even when two first uses arrive in the same tick, where each used to build a BullMQ `Queue` of which only the last was kept and closed; the `local` driver, the worker and the schedules log a failure with a non-`Error` value through `toError`, so the job's name stays in the line; `close()` on the `bullmq` driver waits for a queue still opening and closes it too, closes every queue even when one refuses, and reports the refusal afterwards.
