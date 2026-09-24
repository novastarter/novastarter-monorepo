---
'@novastarter/queue': patch
'@novastarter/memory': patch
'@novastarter/redis': patch
'@novastarter/pressure': patch
'@novastarter/emitter': patch
---

A `unique` function in `defineJob()` options now receives the parsed payload of the job's schema instead of `any`.
