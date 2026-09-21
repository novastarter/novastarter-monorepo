---
'@novastarter/utils': minor
'@novastarter/redis': minor
'@novastarter/payments': minor
'@novastarter/queue': minor
---

`location()` on every manager answers with the `default` location when called without a name — `DEFAULT_LOCATION` of `@novastarter/utils` — so `DEFAULT_REDIS_LOCATION`, `DEFAULT_PAYMENTS_LOCATION` and `DEFAULT_QUEUE_LOCATION` are gone; import `DEFAULT_LOCATION` from `@novastarter/utils` instead.
