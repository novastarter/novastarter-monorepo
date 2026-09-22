---
'@novastarter/storage-driver-local': patch
'@novastarter/storage-driver-gcs': patch
'@novastarter/storage-driver-azure': patch
'@novastarter/storage-driver-s3': patch
'@novastarter/storage-driver-cloudinary': patch
'@novastarter/storage-driver-supabase': patch
---

`read()` with a range that names only `end` reads the first bytes up to `end` on every driver: the local, GCS and Azure drivers took a zero bound for an absent one and read the whole object, and S3, Cloudinary and Supabase sent `bytes=-N`, which HTTP reads as the last N bytes; they now send `bytes=0-N`.
