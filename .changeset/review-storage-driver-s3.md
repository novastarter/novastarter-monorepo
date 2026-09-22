---
'@novastarter/storage-driver-s3': patch
---

S3 driver now completes resumable uploads whose parts are of uneven sizes, keeps the multipart upload id for a TUS create without metadata, removes the object on a termination after a completed upload, closes the temp-file streams of failed and skipped parts and turns back semaphore permits granted after a failed chunk; it refuses a `tus.chunkSize` below the S3 minimum of 5 MiB at construction and answers a PATCH that could store no byte with a 400 instead of an unchanged offset, so raise `tus.chunkSize` and client chunk sizes to at least 5 MiB.
