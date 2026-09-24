---
'@novastarter/storage': patch
'@novastarter/storage-driver-azure': minor
'@novastarter/storage-driver-cloudinary': minor
'@novastarter/storage-driver-gcs': minor
'@novastarter/storage-driver-local': minor
'@novastarter/storage-driver-s3': minor
'@novastarter/storage-driver-supabase': minor
---

Storage drivers no longer have a default export; import them by name, e.g. `import { StorageDriverS3 } from '@novastarter/storage-driver-s3'`.
