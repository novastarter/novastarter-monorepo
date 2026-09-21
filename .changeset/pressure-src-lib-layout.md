---
'@novastarter/pressure': patch
'@novastarter/storage-driver-supabase': patch
---

`@novastarter/pressure` keeps its source under `src/lib/` like the driver-based packages and `@novastarter/storage-driver-supabase` reads the upload chunk size from `@novastarter/constants` instead of a local constant; nothing changes for consumers.
