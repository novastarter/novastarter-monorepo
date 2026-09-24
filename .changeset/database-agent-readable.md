---
'@novastarter/database': patch
'@novastarter/database-driver-d1': minor
'@novastarter/database-driver-mysql': minor
'@novastarter/database-driver-neon': minor
'@novastarter/database-driver-pglite': minor
'@novastarter/database-driver-postgres': minor
'@novastarter/database-driver-sqlite': minor
'@novastarter/database-driver-supabase': minor
'@novastarter/database-driver-turso': minor
---

Database drivers no longer have a default export; import them by name, e.g. `import { DatabaseDriverPostgres } from '@novastarter/database-driver-postgres'`.
