---
'@novastarter/storage-driver-gcs': patch
---

`deleteChunkedUpload` no longer rejects when the object is missing: an unfinished resumable upload leaves no object in the bucket, so terminating it now deletes with `ignoreNotFound`, the way the other drivers answer.
