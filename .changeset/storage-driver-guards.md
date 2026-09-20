---
'@novastarter/storage-driver-azure': patch
'@novastarter/storage-driver-cloudinary': patch
'@novastarter/storage-driver-gcs': patch
'@novastarter/storage-driver-local': patch
'@novastarter/storage-driver-s3': patch
'@novastarter/storage-driver-supabase': patch
---

Storage drivers refuse a missing or invalid option at construction with the same message shape as the mail and push drivers (`The supabase storage driver needs a "serviceRole"`), the Supabase messages no longer name `project_id` / `service_role`, keys that never existed, and a failed chunk write (local) or chunk cleanup (S3) during a resumable upload is logged as a warning through `@novastarter/logger` instead of being dropped silently.
