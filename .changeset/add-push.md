---
'@novastarter/push': minor
'@novastarter/push-driver-webpush': minor
'@novastarter/push-driver-fcm': minor
'@novastarter/push-driver-apns': minor
---

Add `@novastarter/push` with the `PushManager` of `usePush()` — `registerDriver` / `registerLocation` / `registerRoutes` the application calls at start-up, the built-in `console` driver, `sendPush()` routing a message to the location of its target's platform and throwing `PushTargetGoneError` for a subscription or token the push service no longer knows — plus one `@novastarter/push-driver-*` package per platform (Web Push with VAPID, Firebase Cloud Messaging, Apple Push Notification service).
