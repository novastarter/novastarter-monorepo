---
'@novastarter/sms-driver-vonage': patch
---

A message Vonage refused whole is now reported as a refusal, so `sendSms()` falls back, instead of a non-retryable `SmsPartialDeliveryError` with nothing delivered.
