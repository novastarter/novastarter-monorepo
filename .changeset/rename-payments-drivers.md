---
'@novastarter/payments': minor
'@novastarter/payments-driver-stripe': minor
'@novastarter/payments-driver-paddle': minor
'@novastarter/payments-driver-polar': minor
'@novastarter/payments-driver-lemonsqueezy': minor
---

`DriverStripe`, `DriverPaddle`, `DriverPolar` and `DriverLemonSqueezy` are now `PaymentsDriverStripe`, `PaymentsDriverPaddle`, `PaymentsDriverPolar` and `PaymentsDriverLemonSqueezy` with `PaymentsDriver…Config` option types, and `PaymentsDriverConfig` is removed — use `LocationConfig<PaymentsDrivers>` of `@novastarter/utils`.
