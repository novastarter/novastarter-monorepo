---
'@novastarter/database': patch
---

The readme of `@novastarter/database` lists the eight driver packages and says which locations can swap drivers: the Postgres ones (`postgres`, `supabase`, `neon`, `neon-http`, `pglite`) among themselves, while `sqlite`, `turso` and `d1` share `sqliteTable` but not the API — `BetterSQLite3Database` is synchronous, `LibSQLDatabase` and `DrizzleD1Database` asynchronous.
