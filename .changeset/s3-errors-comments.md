---
'@novastarter/storage-driver-s3': minor
---

A wrong s3 driver config now throws `InvalidConfigError`, and `call()` with an unknown command or extra headers throws `InvalidPayloadError`.
