---
'@novastarter/push': minor
'@novastarter/push-driver-apns': patch
'@novastarter/push-driver-fcm': patch
---

Add `toCollapseId()` and `COLLAPSE_ID_MAX_LENGTH` to `@novastarter/push`: both token drivers now build the APNs collapse id with the same sanitising — every code point outside `A-Za-z0-9_.:-` becomes `_`, cut to 64 bytes — so one message tag yields the same collapse id on APNs and through FCM.
