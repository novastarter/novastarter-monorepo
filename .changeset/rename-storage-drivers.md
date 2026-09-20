---
'@novastarter/storage': minor
'@novastarter/types': minor
'@novastarter/storage-driver-s3': minor
'@novastarter/storage-driver-local': minor
'@novastarter/storage-driver-gcs': minor
'@novastarter/storage-driver-azure': minor
'@novastarter/storage-driver-cloudinary': minor
'@novastarter/storage-driver-supabase': minor
'@novastarter/utils': patch
---

`Driver` of `@novastarter/storage` is now `StorageDriver` and the driver classes are `StorageDriverS3`, `StorageDriverLocal`, `StorageDriverGcs`, `StorageDriverAzure`, `StorageDriverCloudinary` and `StorageDriverSupabase` with matching `…Config` option types; `Range`, `Stat`, `ReadOptions` and `ChunkedUploadContext` moved from `@novastarter/types` into `@novastarter/storage`, and `DriverConfig` and the drivers' helper exports (`kmsKeyIdCheck`, `DEFAULT_CHUNK_SIZE`) are gone — rename the imports; the driver keys (`s3`, `local`, …) are unchanged.
