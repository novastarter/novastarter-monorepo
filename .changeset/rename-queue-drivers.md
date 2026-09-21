---
'@novastarter/queue': minor
---

`QueueProvider` is now the `QueueDriver` contract without a `type` field, the built-in drivers are `QueueDriverLocal` / `QueueDriverBullmq` with `QueueDriverLocalConfig` / `QueueDriverBullmqConfig` option types; the `local` and `bullmq` location keys are unchanged.
