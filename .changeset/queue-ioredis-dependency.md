---
'@novastarter/queue': patch
---

`ioredis` is a regular dependency instead of an optional peer, since `@novastarter/redis` already requires it and the `bullmq` driver's types import it; nothing to install.
