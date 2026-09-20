---
'@novastarter/payments-driver-stripe': minor
---

`DriverStripe` takes an optional `appInfo` (`{ name, version?, url?, partner_id? }`) shown in Stripe's request logs; without it the client no longer identifies itself as `Novastarter`.
