---
'@novastarter/payments': minor
---

Add `handleWebhook(rawBody, headers, { location? })`, which verifies a delivery through a payments location, runs the normalised event through the `payments.webhook` filter of `@novastarter/emitter` and emits `payments.received` or `payments.failed`, so a route hands the raw request over and listeners get every event.
