---
'@novastarter/memory': patch
'@novastarter/redis': patch
'@novastarter/queue': patch
'@novastarter/payments-driver-lemonsqueezy': patch
'@novastarter/payments-driver-polar': patch
'@novastarter/payments-driver-paddle': patch
'@novastarter/payments-driver-stripe': patch
---

`BusDriverRedis.close()` no longer hangs when the subscribing connection never reached `ready`: it is dropped with `disconnect()` instead of reconnecting forever to deliver QUIT, and `CacheDriverMulti.delete()` and `clear()` now keep an in-flight `set` of the same process out of L1, so a concurrent delete can no longer leave a deleted key served from memory.
`createRedis` now recognises a case-insensitive `rediss://` scheme (RFC 3986 §3.1), so a URL such as `REDISS://cache.internal:6380` connects over TLS instead of sending the password in the clear.
`ScheduledJob.stop()` no longer deletes the cluster-wide clock, so a tick that already fired cannot be claimed a second time by a peer during a rolling restart; callers that really want a fresh start use the new `reset()`, and `validateJobDelay` is now exported from the package entry point so application drivers reuse the shared delay check.
The Lemon Squeezy driver now derives the webhook event id from the event, the resource and its update time instead of `meta.webhook_id` (the endpoint's id, identical on every delivery, which made deduplication drop every event after the first), refuses `createCustomer` with metadata — which Lemon Squeezy cannot store — naming `createCheckoutSession` as the place it travels, refuses a `priceId` that is not a positive integer before any request, refuses a request `timeout` of `0` (which `AbortSignal.timeout(0)` would abort immediately), binds the platform `fetch` to the global object so requests no longer throw `TypeError: Illegal invocation` on WebIDL runtimes, and caps `listInvoices` at ten subscription pages, reporting the truncation through the logger.
The Polar driver now drops a `subscription.updated` whose status is `canceled`, since that is the `subscription.revoked` event's news and a retried update would otherwise re-announce a deleted subscription.
The Paddle driver now refuses a `paddle-signature` header whose `ts` is not an integer, since a `NaN` timestamp would have silently disabled the five-second replay window.
The Stripe driver falls back to the subscription-level `current_period_start`/`current_period_end` when the item does not carry them, so a webhook endpoint pinned to an API version before 2025-03-31 no longer maps a `null` billing period.
