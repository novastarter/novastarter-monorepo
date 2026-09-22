---
'@novastarter/storage-driver-s3': patch
---

The S3 driver no longer double-releases a part-upload semaphore permit when a chunk fails while an earlier part is still uploading, so the configured upload concurrency cap is held exactly.
