---
'@novastarter/database': minor
'@novastarter/database-driver-postgres': minor
'@novastarter/database-driver-supabase': minor
'@novastarter/database-driver-neon': minor
'@novastarter/database-driver-mysql': minor
'@novastarter/database-driver-sqlite': minor
'@novastarter/database-driver-d1': minor
'@novastarter/database-driver-pglite': minor
'@novastarter/database-driver-turso': minor
---

Every database driver exposes `capabilities.transactions`, `false` on `neon-http` and `d1` where Drizzle's `db.transaction()` cannot work, so an application picks `db.batch()` by fact rather than by driver name.
