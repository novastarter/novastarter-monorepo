---
'@novastarter/storage-driver-s3': patch
'@novastarter/storage': patch
---

S3 driver throws a descriptive error when a chunked upload is finished or written without a prior `createChunkedUpload`, and the storage contract documents the driver-specific delete-of-missing-object semantics and the reserved `contentType` and `cacheControl` upload metadata keys.
