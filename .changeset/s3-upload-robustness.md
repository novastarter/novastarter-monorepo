---
'@novastarter/storage-driver-s3': patch
---

Resumable uploads no longer crash the process when a part upload fails while a chunk is still streaming, and finishing a zero-length resumable upload now writes the empty object with a plain `PutObject` instead of failing with S3's MalformedXML error.
