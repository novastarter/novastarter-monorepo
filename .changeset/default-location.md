---
'@novastarter/utils': minor
'@novastarter/redis': minor
'@novastarter/payments': minor
'@novastarter/queue': minor
---

`location()` on every manager answers with the `default` location when called without a name — `DEFAULT_LOCATION` of `@novastarter/utils` — so `DEFAULT_PAYMENTS_LOCATION` and `DEFAULT_QUEUE_LOCATION` are gone and `RedisManager` no longer needs a `location()` override of its own; import `DEFAULT_LOCATION` from `@novastarter/utils` instead. `close()` releases every built location even when one of them fails, drops them all and then throws the failure — an `AggregateError` when there are several — and a falsy instance counts as built.
