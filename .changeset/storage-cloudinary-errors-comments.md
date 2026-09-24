---
'@novastarter/storage-driver-cloudinary': minor
'@novastarter/storage': patch
---

A wrong cloudinary driver config now throws `InvalidConfigError`, and an empty `write()` or an oversized TUS chunk throws `InvalidPayloadError`.
