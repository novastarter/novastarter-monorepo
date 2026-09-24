---
'@novastarter/push': minor
'@novastarter/push-driver-apns': minor
'@novastarter/push-driver-fcm': minor
'@novastarter/push-driver-webpush': minor
---

Push setup mistakes (a missing or broken key, an unknown location, a location that does not serve the platform) now throw `InvalidConfigError`, and a driver sent the wrong kind of target throws `InvalidPayloadError`, both from `@novastarter/errors`.
