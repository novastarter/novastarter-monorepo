---
'@novastarter/sms': patch
'@novastarter/sms-driver-vonage': patch
'@novastarter/sms-driver-twilio': patch
---

A message a Vonage location delivered in part now stops the chain: `sendSms()` rethrows the driver's non-retryable `SmsPartialDeliveryError` (code `SMS_PARTIAL_DELIVERY`) as-is instead of falling back, so the delivered parts are never re-sent and double-billed, the Vonage `verify()` drains the balance response so its socket returns to the pool, and the Twilio driver's own axios timeout is reported as the kit's `TimeoutError`, as `call()` documents.
