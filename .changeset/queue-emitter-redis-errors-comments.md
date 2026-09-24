---
'@novastarter/queue': minor
'@novastarter/emitter': patch
'@novastarter/redis': patch
---

A queue set up wrong (a `bullmq` driver without a `connection`, a queue with no location and no default one, a worker on a queue that is not on `bullmq`, or a missing `bullmq` package) now throws `InvalidConfigError` (`INVALID_CONFIG`) from `@novastarter/errors` instead of a plain `Error`, so callers can match on its class or code; the emitter and redis packages only had their inline comments cleaned up, with no change in behaviour.
