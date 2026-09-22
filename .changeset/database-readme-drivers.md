---
'@novastarter/database': patch
---

The readme of `@novastarter/database` lists the six driver packages and says which locations can swap drivers: the Postgres ones (`postgres`, `supabase`, `neon`, `neon-http`) among themselves, while `sqlite` and `d1` share `sqliteTable` but not the synchronous API.
