---
'@novastarter/payments-driver-lemonsqueezy': patch
---

Refuse `cancelSubscription({ immediately: true })` instead of quietly cancelling at period end, and map partially refunded subscription invoices to `paid` instead of `open`.
