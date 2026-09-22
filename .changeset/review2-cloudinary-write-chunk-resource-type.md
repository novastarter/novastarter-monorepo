---
'@novastarter/storage-driver-cloudinary': patch
---

Cloudinary `writeChunk` now derives the resource type from the resolved full path, like `write`, `delete` and `move` already do, so a root folder whose name carries an extension can no longer mislabel a chunked upload's asset type.
