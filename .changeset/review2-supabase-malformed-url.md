---
'@novastarter/database-driver-supabase': patch
---

The supabase database driver now refuses a malformed connection `url` with its own message (`The supabase database driver needs a "url" that is a valid URL`) instead of the raw `TypeError: Invalid URL` that `new URL` raises.
