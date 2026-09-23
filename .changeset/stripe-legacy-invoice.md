---
'@novastarter/payments-driver-stripe': patch
---

`toInvoice` now falls back to the top-level `subscription` of invoice payloads delivered to webhook endpoints pinned to a Stripe API version before 2025-03-31, so `subscriptionId` maps for those invoices instead of silently becoming `null`.
