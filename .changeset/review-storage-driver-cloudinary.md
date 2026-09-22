---
'@novastarter/storage-driver-cloudinary': patch
---

Cloudinary driver no longer drops bytes when a source stream chunk is larger than the 5.5 MB upload chunk, keeps `+`, `&`, `=` and `%` in public ids intact in stat/exists/move/delete requests, and gives every write and TUS upload its own `X-Unique-Upload-Id` so concurrent uploads started in the same millisecond no longer share one.
