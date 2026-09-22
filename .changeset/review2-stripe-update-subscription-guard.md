---
'@novastarter/payments-driver-stripe': patch
---

`updateSubscription` now refuses with an error naming the subscription when neither a `priceId` nor a `quantity` is given, before any request is sent — the no-op call the SDK would otherwise get is gone, matching the other drivers.
