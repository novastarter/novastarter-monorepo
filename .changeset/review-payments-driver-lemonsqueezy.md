---
'@novastarter/payments-driver-lemonsqueezy': minor
---

Lemon Squeezy driver now honours `proration: 'none'` on a seat-only change, collects every page of a customer's subscriptions in `listInvoices`, answers `InvalidPayloadError` for a signed body without `data.attributes`, and refuses a `timeout` that is not a whole number from 0 to 2147483647 with a `RangeError` at registration (`MAX_TIMEOUT` is exported from the API client).
