---
'@novastarter/storage-driver-local': patch
'@novastarter/storage-driver-gcs': patch
'@novastarter/storage-driver-azure': patch
---

`read()` with `range: { end: 0 }` now reads the first byte on the local, GCS and Azure drivers, as it already did on S3, Cloudinary and Supabase; a zero bound used to be taken for an absent one and the whole object was read.
