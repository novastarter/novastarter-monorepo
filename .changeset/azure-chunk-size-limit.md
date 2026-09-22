---
'@novastarter/storage-driver-azure': patch
---

`writeChunk` now refuses a chunk above the size configured as `tus.chunkSize`, or above the 100 MiB append-block limit when no size is configured, instead of relying on the service to reject it mid-upload.
