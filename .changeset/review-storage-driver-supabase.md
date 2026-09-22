---
'@novastarter/storage-driver-supabase': patch
---

Supabase `stat`/`exists` now answer only for a file of exactly the requested name (no more matches on `name.bak`, other case or a same-named folder), `list()` rejects with `Error listing prefix "…"` instead of ending silently when a page fails, a failed lookup behind `stat`/`exists` is thrown as `Error looking up file "…"` with the storage error as `cause`, and a non-404 error on `read()` is thrown as `Couldn't read file "…" (<status>)` with Supabase's response body as `cause` — adjust any `catch` that matched the raw `StorageError` or the old "No stream returned" message.
