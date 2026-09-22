---
'@novastarter/storage-driver-supabase': patch
---

Supabase `stat()` no longer reports `size: 0` and the epoch for a listing entry whose metadata is missing: like the S3, GCS and Azure drivers, it now throws `No stat returned for file "…": the listing entry has no size or modification time` — adjust any `catch` that relied on the zero fallback.
