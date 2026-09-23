---
'@novastarter/sms-driver-vonage': patch
---

A message Vonage refused whole is now reported as a refusal, so `sendSms()` falls back, instead of a non-retryable `SmsPartialDeliveryError` with nothing delivered.
Vonage driver no longer attaches the SDK's HTTP error, which carries the API key and secret, as the `cause` of a failed send, and now reports `segments` as a number instead of the string Vonage sends.
