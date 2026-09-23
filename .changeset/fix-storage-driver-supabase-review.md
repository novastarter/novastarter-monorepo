---
'@novastarter/storage-driver-supabase': patch
---

`list()` no longer yields objects that only match the prefix case-insensitively or through a `_` or `%` wildcard (such as `Report.pdf` for `report`); it now returns only names that start with the prefix exactly.

Terminating a resumable upload now aborts the Supabase TUS upload instead of deleting the object already stored under that name; a resumed chunk is refused when Supabase holds the upload at another offset (a retry of a chunk that already landed resolves without resending it); and `copy()`/`move()` now overwrite an existing destination like the other drivers.

`move()` onto the same object (such as `a.png` to `./a.png`) no longer deletes it; terminating a resumable upload Supabase already expired or finished (404/410) now resolves; and a resumed chunk whose Supabase upload is gone now fails instead of silently starting a new upload at offset 0.
