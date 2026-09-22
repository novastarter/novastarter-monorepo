---
'@novastarter/push-driver-apns': patch
'@novastarter/push-driver-fcm': minor
'@novastarter/sms-driver-twilio': patch
'@novastarter/sms-driver-vonage': patch
---

APNs: `low` and `very-low` urgency alerts no longer fail with APNs's `400 BadPriority` — priority 1 is legal for `background` pushes only, so both map to 5. FCM: a failing `getMessaging()` no longer leaks the half-built Firebase app into the SDK's global registry, and a new optional `timeout` fails a send that outlives it, the request itself running on. Twilio: `close()` destroys the keep-alive agent the SDK pools connections in. Vonage: `verify()` now bounds its balance fetch with the configured `timeout`.
