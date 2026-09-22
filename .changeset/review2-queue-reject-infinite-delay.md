---
'@novastarter/queue': patch
---

The queue drivers now refuse a job delay that is not finite — `Infinity` included — with the same `RangeError` a negative or `NaN` delay gets, instead of the `local` driver re-arming its timer slices forever so the job silently never runs.
