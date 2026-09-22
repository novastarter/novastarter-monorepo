---
'@novastarter/payments-driver-stripe': patch
---

`listInvoices` now asks Stripe for twenty invoices when the caller gives no `limit`, the kit's default across providers — without a limit it silently paged at Stripe's own default of ten.
