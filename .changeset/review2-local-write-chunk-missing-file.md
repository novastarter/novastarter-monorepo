---
'@novastarter/storage-driver-local': patch
---

Local `writeChunk` no longer surfaces a raw `ENOENT` when the upload's file is missing: it throws `StorageFileNotFoundError` (with the file system's error as `cause`), the same error `read` and `stat` use for a path that cannot exist.
