---
'@novastarter/database': minor
'@novastarter/database-driver-d1': minor
'@novastarter/database-driver-mysql': minor
'@novastarter/database-driver-neon': minor
'@novastarter/database-driver-pglite': minor
'@novastarter/database-driver-postgres': minor
'@novastarter/database-driver-sqlite': minor
'@novastarter/database-driver-supabase': minor
'@novastarter/database-driver-turso': minor
---

A missing or malformed driver config (`connection`, `file`, `binding`, `url`) or a `migrate()` call without `migrationsFolder` now throws `InvalidConfigError` (`INVALID_CONFIG`) instead of a plain `Error`, so callers can match it with `isNovastarterError(error, 'INVALID_CONFIG')`.
