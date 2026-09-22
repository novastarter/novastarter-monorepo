---
'@novastarter/database-driver-postgres': patch
'@novastarter/database-driver-supabase': patch
'@novastarter/database-driver-sqlite': patch
---

`@types/pg` and `@types/better-sqlite3` are regular dependencies of the drivers now, so the `pg` and better-sqlite3 types in their declarations resolve without installing the types yourself.
