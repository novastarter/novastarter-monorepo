---
'@novastarter/payments-driver-polar': patch
---

Polar driver no longer drops a webhook of a known event type whose payload the SDK's schema rejects, nor answers 500 for a signed body that is not JSON — both are refused with `InvalidPayloadError` (400) — and invoice `amountPaid` / `amountDue` now follow the order's `due_amount`, so a customer balance applied by Polar is reflected.
