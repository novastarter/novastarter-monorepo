---
'@novastarter/queue': minor
---

`QueueProvider` is now the `QueueDriver` contract without a `type` field, the built-in drivers are `QueueDriverLocal` / `QueueDriverBullmq` with `QueueDriverLocalConfig` / `QueueDriverBullmqConfig` option types, and `ioredis` is an optional peer dependency like `bullmq`; the `local` and `bullmq` location keys are unchanged.
