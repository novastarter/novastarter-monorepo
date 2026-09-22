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

Database drivers take a `label` option, which `DatabaseManager.registerLocation` fills with the location's name, and log through `resolveLogger()` — a child of the kit logger carrying `database: "<name>"` — so pool errors, failed boots and query logs say which location they came from.
