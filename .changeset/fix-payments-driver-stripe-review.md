---
'@novastarter/payments-driver-stripe': patch
---

Fix `call()` so the SDK no longer retries a request after its timeout or abort, which could apply a `POST` the caller was told had failed; and send `payment_behavior: 'pending_if_incomplete'` from `updateSubscription()`, so a price change whose payment fails is not applied.

`updateSubscription()` now throws when the change's payment failed and Stripe holds the change in `pending_update`, instead of answering the unchanged subscription as if the change was made. `call()` retries no request at all, `GET` included; a caller that wants a retry makes it itself, with its own `Idempotency-Key` on a `POST`.
