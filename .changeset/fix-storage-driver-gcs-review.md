---
'@novastarter/storage-driver-gcs': patch
---

`writeChunk` now returns the offset GCS actually kept and stores the CRC32C of exactly those bytes, so a chunk that is not a multiple of 256 KiB no longer leaves the TUS offset ahead of the session and corrupts the upload.
