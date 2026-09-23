---
'@novastarter/storage-driver-gcs': patch
---

`writeChunk` now returns the offset GCS actually kept and stores the CRC32C of exactly those bytes, so a chunk that is not a multiple of 256 KiB no longer leaves the TUS offset ahead of the session and corrupts the upload.

Stop a TUS termination of an unfinished upload from deleting the object already stored at the target path; only the object of an upload GCS has finalised is removed. A `completed` key sent by the client in `Upload-Metadata` is dropped, so it cannot fake a finished upload.
