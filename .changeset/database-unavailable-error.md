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

`ping()` of every database driver now throws `DatabaseUnavailableError` of `@novastarter/database` (code `DATABASE_UNAVAILABLE`, status 503) naming the location, with the backend's error as `cause`; catch it with `instanceof` or `isNovastarterError(error, 'DATABASE_UNAVAILABLE')`.
