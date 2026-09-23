---
'@novastarter/push-driver-fcm': patch
'@novastarter/push-driver-webpush': patch
---

The fcm driver now also sends the stringified Web Push payload under `webpush.data.payload`, so a service worker written against the kit's payload contract can read it back with one `JSON.parse` on FCM web targets, and the webpush driver now refuses malformed VAPID keys at registration instead of failing every send with the library's raw error.
