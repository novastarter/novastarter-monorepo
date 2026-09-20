---
'@novastarter/storage': minor
'@novastarter/storage-driver-azure': minor
'@novastarter/storage-driver-cloudinary': minor
'@novastarter/storage-driver-gcs': minor
'@novastarter/storage-driver-local': minor
'@novastarter/storage-driver-s3': minor
'@novastarter/storage-driver-supabase': minor
---

`stat()` of every storage driver now throws `StorageFileNotFoundError` of `@novastarter/storage` (code `STORAGE_FILE_NOT_FOUND`, status 404) for a missing object instead of the backend's own error; catch it with `instanceof` or `isNovastarterError(error, 'STORAGE_FILE_NOT_FOUND')`.
