---
'@novastarter/payments': minor
'@novastarter/payments-driver-lemonsqueezy': minor
'@novastarter/payments-driver-stripe': minor
---

Driver configuration mistakes and an unknown webhook location now throw `InvalidConfigError` (`INVALID_CONFIG`), and invalid calls such as an update with nothing to change throw `InvalidPayloadError` (`INVALID_PAYLOAD`), so callers can match on the code instead of a plain `Error` message.
