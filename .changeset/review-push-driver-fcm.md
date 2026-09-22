---
'@novastarter/push-driver-fcm': patch
---

FCM driver no longer fails the whole send for a relative `image` (it now reaches browsers only), sends `apns-expiration: 0` for `ttl: 0` so iOS gets a now-or-never message, and cuts the APNs collapse id to 64 UTF-8 bytes on a character boundary instead of 64 UTF-16 units.
