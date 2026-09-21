---
'@novastarter/storage-driver-s3': patch
'@novastarter/storage-driver-azure': patch
'@novastarter/storage-driver-gcs': patch
'@novastarter/storage-driver-cloudinary': patch
---

Object keys are built with `joinPath` of `@novastarter/utils` instead of `node:path`, so they come out with forward slashes on every platform; the S3 driver polls for multipart parts through `retry`.
