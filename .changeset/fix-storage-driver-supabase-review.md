---
'@novastarter/storage-driver-supabase': patch
---

`list()` no longer yields objects that only match the prefix case-insensitively or through a `_` or `%` wildcard (such as `Report.pdf` for `report`); it now returns only names that start with the prefix exactly.
