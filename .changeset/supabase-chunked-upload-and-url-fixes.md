---
'@novastarter/storage-driver-supabase': patch
---

`writeChunk` no longer crashes with a TypeError when the client sends no `Upload-Metadata` and falls back to `application/octet-stream` for a chunk without a type instead of `image/png`; the authenticated download URL is built with `joinPath`, so it keeps forward slashes on every platform.
