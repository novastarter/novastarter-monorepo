---
'@novastarter/utils': minor
'@novastarter/redis': minor
'@novastarter/payments': minor
'@novastarter/queue': minor
---

`location()` on every manager answers with the `default` location when called without a name — `DEFAULT_LOCATION` of `@novastarter/utils` — so `DEFAULT_PAYMENTS_LOCATION` and `DEFAULT_QUEUE_LOCATION` are gone and `RedisManager` no longer needs a `location()` override of its own; import `DEFAULT_LOCATION` from `@novastarter/utils` instead. `close()` takes the built locations out of the registry before releasing them — a `location()` during the run builds afresh instead of getting an instance about to be closed, and what it builds stays for the next `close()` — releases every one even when another fails, waits for a `close()` already under way instead of releasing twice and then releases what was built meanwhile, treats a `release()` that throws before returning a promise like a rejection, and then throws the failure — both, as an `AggregateError`, when the run it waited for and its own run failed — an `AggregateError` when there are several; a falsy instance counts as built.
