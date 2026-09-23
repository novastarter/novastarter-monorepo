---
'@novastarter/payments-driver-paddle': patch
---

Paddle driver: `listInvoices` now pages through transactions instead of stopping at 30, and `updateSubscription` keeps every item other than the first instead of removing add-ons.
