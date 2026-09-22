---
'@novastarter/push-driver-apns': patch
---

APNs driver now enforces `requestTimeout` itself (a send that outlives it fails with a `TimeoutError` cause instead of hanging), sanitizes `tag` into a valid 64-byte `apns-collapse-id` instead of failing the request on non-Latin-1 characters, and keeps the SDK error as the `cause` of `PushTargetGoneError`.
