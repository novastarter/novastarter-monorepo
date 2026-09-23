---
'@novastarter/notifications': minor
---

Add `@novastarter/notifications`: register the channels (`mailChannel`, `smsChannel`, `pushChannel`, `inAppChannel` or your own) and the app's `findRecipient`, `render` and `isEnabled` with `registerNotifications()`, then `plan()` a notification and `send()` it one channel per queue job.
