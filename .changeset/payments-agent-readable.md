---
'@novastarter/payments': patch
'@novastarter/payments-driver-lemonsqueezy': minor
'@novastarter/payments-driver-paddle': minor
'@novastarter/payments-driver-polar': minor
'@novastarter/payments-driver-stripe': minor
---

Payments drivers no longer have a default export; import them by name, e.g. `import { PaymentsDriverStripe } from '@novastarter/payments-driver-stripe'`.
