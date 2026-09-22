---
'@novastarter/payments-driver-stripe': patch
---

Stripe driver no longer announces `checkout.completed` for a subscription checkout completed with a still-unpaid delayed payment (SEPA/ACH debit, bank transfer) — the purchase is announced once by `checkout.session.async_payment_succeeded` — and `parseWebhook` now rejects a signed body that is not a Stripe event with `InvalidPayloadError` instead of resolving `null`.
