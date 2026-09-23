---
'@novastarter/storage-driver-s3': patch
---

S3 driver no longer deletes the existing object when a TUS upload to its key is terminated before completion, and a chunk whose part upload failed half-way can now be resent without storing its bytes twice and leaving the upload unable to finish.
