---
'@novastarter/queue': patch
---

`createWorker()` now fails with the install hint `Queue driver "bullmq" needs the "bullmq" package: pnpm add bullmq` when the optional peer is missing, the same message `QueueDriverBullmq` already gave; the loader lives in one shared helper.
