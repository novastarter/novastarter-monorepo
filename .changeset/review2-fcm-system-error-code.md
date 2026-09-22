---
'@novastarter/push-driver-fcm': patch
---

FCM driver no longer mistakes Node system errors such as `ECONNRESET` for coded FCM refusals — only Firebase's own `messaging/…` codes are read as refusals, so a network failure is reported as one again.
